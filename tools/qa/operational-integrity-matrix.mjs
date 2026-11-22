import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Invoked only after the identity runner has verified its disposable host.
// Uses fresh synthetic organizations and real HTTP/SQL; no delivery credentials.
export async function runOperationalMatrix({
  db,
  check,
  request,
  expectStatus,
  organization,
  actor,
}) {
  const org = await organization();
  const otherOrg = await organization();
  const owner = await actor(org);
  const foreign = await actor(otherOrg);
  const lawyer = await actor(org, 'lawyer');
  const post = (who, path, body) => request(who, path, { method: 'POST', body });
  const patch = (who, path, body) => request(who, path, { method: 'PATCH', body });
  const client = expectStatus(
    await post(owner, '/clients', { type: 'PERSON', displayName: 'Operational synthetic client' }),
    201,
  );
  const portal = await actor(org, 'client', client.id);

  await check('OPS-TASK-LIFECYCLE-PERSISTENCE', async () => {
    const task = expectStatus(
      await post(owner, '/tasks', {
        title: 'Operational synthetic task',
        clientId: client.id,
        assigneeId: lawyer.userId,
      }),
      201,
    );
    assert(expectStatus(await request(owner, '/tasks'), 200).some((row) => row.id === task.id));
    for (const status of ['IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'OPEN', 'CANCELLED']) {
      expectStatus(await patch(owner, '/tasks/' + task.id, { status }), 200);
      const stored = await db.task.findUniqueOrThrow({ where: { id: task.id } });
      assert.equal(stored.status, status);
      assert.equal(Boolean(stored.completedAt), status === 'COMPLETED');
    }
    const comment = expectStatus(
      await post(owner, '/tasks/' + task.id + '/comments', {
        body: 'Operational synthetic comment',
      }),
      201,
    );
    assert.equal(
      (await db.taskComment.findUniqueOrThrow({ where: { id: comment.id } })).taskId,
      task.id,
    );
    const reminder = expectStatus(
      await post(owner, '/tasks/' + task.id + '/reminders', {
        remindAt: '2035-01-01T12:00:00Z',
      }),
      201,
    );
    assert.equal(
      (await db.taskReminder.findUniqueOrThrow({ where: { id: reminder.id } })).taskId,
      task.id,
    );
    assert.equal(await db.taskHistory.count({ where: { taskId: task.id } }), 7);
    expectStatus(await patch(foreign, '/tasks/' + task.id, { status: 'COMPLETED' }), 404);
    expectStatus(await post(foreign, '/tasks/' + task.id + '/comments', { body: 'Denied' }), 404);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status, 'CANCELLED');
  });

  await check('OPS-NOTES-MESSAGES-PORTAL-ISOLATION', async () => {
    const note = expectStatus(
      await post(owner, '/internal-notes', {
        clientId: client.id,
        body: 'Operational confidential note',
      }),
      201,
    );
    assert.equal(
      (await db.internalNote.findUniqueOrThrow({ where: { id: note.id } })).confidential,
      true,
    );
    expectStatus(await request(portal, '/internal-notes?clientId=' + client.id), 403);
    assert(
      !expectStatus(await request(foreign, '/internal-notes'), 200).some(
        (row) => row.id === note.id,
      ),
    );
    const message = expectStatus(
      await post(portal, '/client-messages', {
        clientId: client.id,
        body: 'Operational portal message',
      }),
      201,
    );
    assert(
      expectStatus(await request(owner, '/client-messages?clientId=' + client.id), 200).some(
        (row) => row.id === message.id,
      ),
    );
    assert.equal(
      (await db.clientMessage.findUniqueOrThrow({ where: { id: message.id } })).body,
      'Operational portal message',
    );
  });

  const eventBody = {
    title: 'Operational synthetic hearing',
    clientId: client.id,
    type: 'HEARING',
    startsAt: '2035-02-01T12:00:00Z',
    endsAt: '2035-02-01T13:00:00Z',
    timezone: 'America/Sao_Paulo',
    reminderMinutes: [60, 15],
  };
  await check('OPS-CALENDAR-REMINDERS-RESCHEDULE-CANCEL', async () => {
    const event = expectStatus(await post(owner, '/calendar-events', eventBody), 201);
    const pending = () =>
      db.notification.count({
        where: {
          organizationId: org,
          status: 'PENDING',
          metadata: { path: ['eventId'], equals: event.id },
        },
      });
    assert.equal(await pending(), 2);
    assert(
      expectStatus(await request(owner, '/calendar-events'), 200).some(
        (row) => row.id === event.id,
      ),
    );
    expectStatus(
      await patch(owner, '/calendar-events/' + event.id, {
        startsAt: '2035-02-02T12:00:00Z',
        endsAt: '2035-02-02T13:00:00Z',
      }),
      200,
    );
    assert.equal(await pending(), 2);
    assert.equal(
      (
        await db.calendarEvent.findUniqueOrThrow({ where: { id: event.id } })
      ).startsAt.toISOString(),
      '2035-02-02T12:00:00.000Z',
    );
    expectStatus(
      await patch(foreign, '/calendar-events/' + event.id, { status: 'CANCELLED' }),
      404,
    );
    expectStatus(await patch(owner, '/calendar-events/' + event.id, { status: 'CANCELLED' }), 200);
    assert.equal(await pending(), 0);
    assert.equal(
      (await db.calendarEvent.findUniqueOrThrow({ where: { id: event.id } })).status,
      'CANCELLED',
    );
  });
  for (const [name, body] of [
    ['TIMEZONE', { ...eventBody, timezone: 'Invalid/Timezone' }],
    ['RANGE', { ...eventBody, endsAt: eventBody.startsAt }],
    ['DUPLICATE-REMINDER', { ...eventBody, reminderMinutes: [15, 15] }],
  ])
    await check('OPS-CALENDAR-INVALID-' + name, async () => {
      const before = await db.calendarEvent.count({ where: { organizationId: org } });
      expectStatus(await post(owner, '/calendar-events', body), 400);
      assert.equal(await db.calendarEvent.count({ where: { organizationId: org } }), before);
    });

  await check('OPS-ADMIN-ROLES-AND-SETTINGS', async () => {
    const key = 'qa_' + randomUUID().replaceAll('-', '');
    const role = expectStatus(
      await post(owner, '/admin/roles', {
        key,
        name: 'Operational read-only role',
        permissions: [{ resource: 'clients', action: 'view' }],
      }),
      201,
    );
    assert.equal(await db.rolePermission.count({ where: { roleId: role.id } }), 1);
    assert(
      expectStatus(await request(owner, '/admin/roles'), 200).some((row) => row.id === role.id),
    );
    expectStatus(
      await post(lawyer, '/admin/roles', { key: 'denied', name: 'Denied', permissions: [] }),
      403,
    );
    expectStatus(
      await patch(owner, '/admin/access-alerts', { enabled: true, times: ['12:01'] }),
      400,
    );
    const settings = { enabled: true, times: ['09:00', '17:30'] };
    expectStatus(await patch(owner, '/admin/access-alerts', settings), 200);
    assert.deepEqual(
      expectStatus(await request(owner, '/admin/access-alerts'), 200).times,
      settings.times,
    );
    const stored = await db.organization.findUniqueOrThrow({ where: { id: org } });
    assert.deepEqual(stored.settings.accessAlerts.times, settings.times);
    expectStatus(await request(lawyer, '/admin/access-alerts'), 403);
  });

  await check('OPS-ADMIN-USER-STATUS-AND-TENANT', async () => {
    const member = await actor(org, 'secretary');
    expectStatus(
      await patch(foreign, '/admin/users/' + member.userId + '/status', { status: 'SUSPENDED' }),
      404,
    );
    expectStatus(
      await patch(owner, '/admin/users/' + member.userId + '/status', { status: 'SUSPENDED' }),
      200,
    );
    assert.equal(
      (await db.organizationMember.findUniqueOrThrow({ where: { userId: member.userId } })).status,
      'SUSPENDED',
    );
    expectStatus(await request(member, '/auth/me'), 401);
    expectStatus(
      await patch(owner, '/admin/users/' + member.userId + '/status', { status: 'ACTIVE' }),
      200,
    );
    expectStatus(await request(member, '/auth/me'), 200);
  });

  await check('OPS-NOTIFICATION-READ-AND-ISOLATION', async () => {
    const notification = await db.notification.create({
      data: {
        organizationId: org,
        userId: owner.userId,
        channel: 'IN_APP',
        status: 'SENT',
        title: 'Operational synthetic notification',
        body: 'No external delivery',
        sentAt: new Date(),
      },
    });
    assert(
      expectStatus(await request(owner, '/notifications'), 200).items.some(
        (row) => row.id === notification.id,
      ),
    );
    expectStatus(await patch(foreign, '/notifications/' + notification.id + '/read', {}), 404);
    expectStatus(await patch(lawyer, '/notifications/' + notification.id + '/read', {}), 404);
    expectStatus(await patch(owner, '/notifications/' + notification.id + '/read', {}), 200);
    const stored = await db.notification.findUniqueOrThrow({ where: { id: notification.id } });
    assert.equal(stored.status, 'READ');
    assert(stored.readAt);
    const push = expectStatus(await request(owner, '/notifications/push/config'), 200);
    assert.equal(push.enabled, false, 'CI must not receive real VAPID delivery credentials');
  });

  const reports = [
    'receivables-due',
    'received',
    'accrual',
    'overdue',
    'aging',
    'cash-forecast',
    'cash-flow',
    'cash-flow-by-client',
    'partial-payments',
    'active-contracts',
    'revenue-by-lawyer',
    'revenue-by-service',
    'delinquent-clients',
    'reconciliation',
  ];
  const range = '?from=2035-01-01&to=2035-12-31&groupBy=day';
  for (const report of reports)
    await check('OPS-REPORT-' + report.toUpperCase(), async () => {
      const result = expectStatus(await request(owner, '/reports/' + report + range), 200);
      assert(Array.isArray(result.rows));
      assert.equal(result.rows.length, 0, 'Fresh operational tenant has no financial ledger');
      const csv = expectStatus(
        await request(owner, '/reports/' + report + '/export.csv' + range),
        200,
      );
      assert.equal(typeof csv, 'string');
      expectStatus(await request(portal, '/reports/' + report + range), 403);
    });
  await check('OPS-AUDIT-DASHBOARD-AND-INVALID-REPORT', async () => {
    expectStatus(await request(owner, '/dashboard/summary'), 200);
    const audit = expectStatus(
      await request(owner, '/audit-logs?category=changes&page=1&pageSize=100'),
      200,
    );
    assert(audit.items.length > 0);
    const ids = audit.items.map((row) => row.id.replace(/^audit:/, ''));
    assert.equal(
      await db.auditLog.count({ where: { id: { in: ids }, organizationId: org } }),
      ids.length,
    );
    expectStatus(await request(owner, '/reports/received?from=2035-12-31&to=2035-01-01'), 400);
    expectStatus(await request(owner, '/reports/unknown/export.csv'), 400);
  });
}

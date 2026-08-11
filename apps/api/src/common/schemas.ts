import { z } from 'zod';

export const uuidSchema = z.string().uuid();
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(160).optional(),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export function pageWindow({ page, pageSize }: PaginationInput) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function pageResult<T>(items: T[], total: number, input: PaginationInput) {
  return {
    items,
    total,
    page: input.page,
    pageSize: input.pageSize,
    pages: Math.ceil(total / input.pageSize),
  };
}

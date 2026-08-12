export type Client = {
  id: string;
  displayName: string;
  legalName?: string;
  type: 'PERSON' | 'COMPANY';
  email?: string;
  phone?: string;
  taxIdNormalized?: string;
  source?: string;
  updatedAt?: string;
};

export type ClientOverview = {
  client: Client;
  contacts: Array<{
    id: string;
    name: string;
    role?: string;
    email?: string;
    phone?: string;
    isPrimary: boolean;
  }>;
  matters: Array<{ id: string; reference: string; title: string; status: string }>;
  contracts: Array<{
    id: string;
    number: string;
    title: string;
    status: string;
    fixedAmount?: string;
    currency: string;
  }>;
  financial: {
    receivables: Array<{
      id: string;
      reference: string;
      status: string;
      originalAmount: string;
      currency: string;
      dueDate: string;
      installments: Array<{
        id: string;
        sequence: number;
        status: string;
        amount: string;
        dueDate: string;
        allocations: Array<{ amount: string }>;
      }>;
    }>;
    payments: Array<{
      id: string;
      reference: string;
      amount: string;
      currency: string;
      status: string;
      paidAt: string;
      method: string;
      documents: Array<{ id: string; title: string }>;
    }>;
  };
  documents: Array<{
    id: string;
    title: string;
    category?: string;
    visibility: string;
    updatedAt: string;
  }>;
  internalNotes: Array<{ id: string; body: string; createdAt: string }>;
  clientMessages: Array<{ id: string; body: string; publishedAt: string }>;
};

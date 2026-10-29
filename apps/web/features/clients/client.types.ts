export type Client = {
  id: string;
  displayName: string;
  legalName?: string;
  type: 'PERSON' | 'COMPANY';
  email?: string;
  phone?: string;
  photoStorageKey?: string | null;
  taxIdNormalized?: string;
  source?: string;
  customFields?: Record<string, unknown>;
  address?: {
    street?: string;
    number?: string;
    complement?: string;
    district?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  };
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
    feeModel: string;
    fixedAmount?: string;
    successRate?: string;
    currency: string;
    serviceName?: string;
    terms?: { services?: string[] };
  }>;
  financial: {
    outstanding: Array<{ currency: string; amount: string }>;
    receivables: Array<{
      id: string;
      reference: string;
      description: string;
      status: string;
      contractId?: string | null;
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
        adjustments: Array<{ amount: string; kind: string }>;
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
    contractId?: string | null;
    visibility: string;
    updatedAt: string;
  }>;
  internalNotes: Array<{ id: string; body: string; createdAt: string }>;
  clientMessages: Array<{ id: string; body: string; publishedAt: string }>;
};

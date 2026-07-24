export interface OpenRequestResult {
  accepted: true;
  delivered: boolean;
}

export interface OpenRequestConnection {
  id: number;
  disconnect: () => void;
}

export interface OpenDocumentIntent {
  path: string;
  modifiedAt: number | null;
}

type DeliverOpenRequest = (intent: OpenDocumentIntent) => void;

export class OpenRequestBroker {
  private readonly clients = new Map<number, DeliverOpenRequest>();
  private nextClientId = 1;
  private pendingIntent: OpenDocumentIntent | null = null;

  connect(
    deliver: DeliverOpenRequest,
    onConnected?: (id: number) => void,
  ): OpenRequestConnection {
    const id = this.nextClientId;
    this.nextClientId += 1;
    this.clients.set(id, deliver);
    onConnected?.(id);

    if (this.pendingIntent !== null) {
      const pendingIntent = this.pendingIntent;
      this.pendingIntent = null;
      deliver(pendingIntent);
    }

    return {
      id,
      disconnect: () => {
        this.clients.delete(id);
      },
    };
  }

  request(intent: OpenDocumentIntent): OpenRequestResult {
    const newestClient = Array.from(this.clients.values()).at(-1);
    if (!newestClient) {
      this.pendingIntent = intent;
      return { accepted: true, delivered: false };
    }

    newestClient(intent);
    return { accepted: true, delivered: true };
  }
}

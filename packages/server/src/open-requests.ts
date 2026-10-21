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
  /**
   * Force the window to switch to the document even while it has focus.
   * Set by explicit user opens (Finder, File > Open, drag and drop); omitted
   * by agent-driven `roughdraft open`, which only switches when the window
   * is in the background.
   */
  activate?: boolean;
}

type DeliverOpenRequest = (intent: OpenDocumentIntent) => void;

interface OpenRequestClient {
  deliver: DeliverOpenRequest;
  router: boolean;
}

export interface OpenRequestConnectionOptions {
  router?: boolean;
}

export class OpenRequestBroker {
  private readonly clients = new Map<number, OpenRequestClient>();
  private nextClientId = 1;
  private pendingIntent: OpenDocumentIntent | null = null;

  connect(
    deliver: DeliverOpenRequest,
    onConnected?: (id: number) => void,
    options: OpenRequestConnectionOptions = {},
  ): OpenRequestConnection {
    const id = this.nextClientId;
    this.nextClientId += 1;
    this.clients.set(id, { deliver, router: options.router === true });
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
    const clientsNewestFirst = Array.from(this.clients.values()).reverse();
    const newestClient =
      clientsNewestFirst.find((client) => client.router) ??
      clientsNewestFirst.at(0);
    if (!newestClient) {
      this.pendingIntent = intent;
      return { accepted: true, delivered: false };
    }

    newestClient.deliver(intent);
    return { accepted: true, delivered: true };
  }
}

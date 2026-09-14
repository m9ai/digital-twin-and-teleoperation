declare module 'urdf-loader' {
  export default class URDFLoader {
    packages: Record<string, string>;
    load(
      url: string,
      onLoad: (robot: THREE.Object3D) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (error: unknown) => void
    ): void;
  }
}

declare module 'roslib' {
  export class Ros {
    constructor(options: { url?: string });
    isConnected: boolean;
    on(event: 'connection' | 'error' | 'close', callback: (data?: unknown) => void): void;
    close(): void;
    callOnConnection(message: string): void;
  }

  export class Topic {
    constructor(options: {
      ros: Ros;
      name: string;
      messageType: string;
      compression?: string;
      throttle_rate?: number;
    });
    subscribe(callback: (message: unknown) => void): void;
    unsubscribe(): void;
    publish(message: Message): void;
  }

  export class Message {
    constructor(values: Record<string, unknown>);
  }

  export class Service {
    constructor(options: {
      ros: Ros;
      name: string;
      serviceType: string;
    });
    callService(
      request: ServiceRequest,
      resultCallback: (result: unknown) => void,
      errorCallback: (error: unknown) => void
    ): void;
  }

  export class ServiceRequest {
    constructor(values: Record<string, unknown>);
  }

  export const ROSLIB: {
    Ros: typeof Ros;
    Topic: typeof Topic;
    Message: typeof Message;
    Service: typeof Service;
    ServiceRequest: typeof ServiceRequest;
  };
}

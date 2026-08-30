declare module "ezuikit-js" {
  export class EZUIKitPlayer {
    constructor(options: {
      id: string;
      accessToken: string;
      url: string;
      template?: string;
      width?: number;
      height?: number;
      audio?: boolean;
      env?: { domain?: string };
    });
    stop(): void;
    play(): void;
  }
}

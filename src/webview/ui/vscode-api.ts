/**
 * VS Code API wrapper for webview
 */

declare const acquireVsCodeApi: () => VsCodeApi;

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): T;
}

class VsCodeApiWrapper {
  private readonly vsCodeApi: VsCodeApi;

  constructor() {
    this.vsCodeApi = acquireVsCodeApi();
  }

  public postMessage(message: unknown): void {
    this.vsCodeApi.postMessage(message);
  }

  public getState<T>(): T | undefined {
    return this.vsCodeApi.getState();
  }

  public setState<T>(state: T): T {
    return this.vsCodeApi.setState(state);
  }
}

// Singleton instance
export const vscode = new VsCodeApiWrapper();

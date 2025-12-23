/**
 * Webview Panel Provider
 * Manages webview panels for timeline, settings, and diff views
 */

import * as vscode from 'vscode';
import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
  TimelineData,
  SettingsData,
  StatusData,
} from './types';

export class WebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codeHistorian.timeline';

  private _view?: vscode.WebviewView;
  private _pendingMessages: ExtensionToWebviewMessage[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _messageHandler: (message: WebviewToExtensionMessage) => Promise<void>
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'dist'),
        vscode.Uri.joinPath(this._extensionUri, 'media'),
        vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'codicons', 'dist'),
      ],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
      if (message.type === 'ready') {
        // Send any pending messages
        for (const pending of this._pendingMessages) {
          await this.postMessage(pending);
        }
        this._pendingMessages = [];
      }
      await this._messageHandler(message);
    });

    // Handle visibility changes
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.postMessage({ type: 'refresh', data: undefined } as any);
      }
    });
  }

  public async postMessage(message: ExtensionToWebviewMessage): Promise<boolean> {
    if (this._view) {
      return this._view.webview.postMessage(message);
    }
    this._pendingMessages.push(message);
    return false;
  }

  public async sendTimeline(data: TimelineData): Promise<void> {
    await this.postMessage({ type: 'timeline', data });
  }

  public async sendStatus(data: StatusData): Promise<void> {
    await this.postMessage({ type: 'status', data });
  }

  public async sendSettings(data: SettingsData): Promise<void> {
    await this.postMessage({ type: 'settings', data });
  }

  public async sendLoading(loading: boolean, message?: string): Promise<void> {
    await this.postMessage({ type: 'loading', data: { loading, message } });
  }

  public async sendError(message: string, details?: string): Promise<void> {
    await this.postMessage({ type: 'error', data: { message, details } });
  }

  public async sendToast(
    type: 'info' | 'success' | 'warning' | 'error',
    message: string,
    duration?: number
  ): Promise<void> {
    await this.postMessage({
      type: 'toast',
      data: {
        id: Date.now().toString(),
        type,
        message,
        duration,
      },
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.css')
    );
    const codiconsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        'node_modules',
        '@vscode/codicons',
        'dist',
        'codicon.css'
      )
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${webview.cspSource} 'unsafe-inline';
    script-src 'nonce-${nonce}';
    font-src ${webview.cspSource};
    img-src ${webview.cspSource} https: data:;
  ">
  <link href="${styleUri}" rel="stylesheet">
  <link href="${codiconsUri}" rel="stylesheet">
  <title>Code Historian</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

/**
 * Panel for detailed views (diff, restore preview, etc.)
 */
export class DetailPanel {
  public static currentPanel: DetailPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionUri: vscode.Uri,
    title: string,
    viewType: string
  ): DetailPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (DetailPanel.currentPanel) {
      DetailPanel.currentPanel._panel.reveal(column);
      DetailPanel.currentPanel._panel.title = title;
      return DetailPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      viewType,
      title,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist'),
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      }
    );

    DetailPanel.currentPanel = new DetailPanel(panel, extensionUri);
    return DetailPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.onDidChangeViewState(
      () => {
        if (this._panel.visible) {
          this._update();
        }
      },
      null,
      this._disposables
    );
  }

  public async postMessage(message: ExtensionToWebviewMessage): Promise<boolean> {
    return this._panel.webview.postMessage(message);
  }

  public onDidReceiveMessage(handler: (message: WebviewToExtensionMessage) => void): void {
    this._panel.webview.onDidReceiveMessage(handler, null, this._disposables);
  }

  public dispose(): void {
    DetailPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  private _update(): void {
    const webview = this._panel.webview;
    this._panel.webview.html = this._getHtmlForWebview(webview);
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'detail-panel.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.css')
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${webview.cspSource} 'unsafe-inline';
    script-src 'nonce-${nonce}';
    font-src ${webview.cspSource};
    img-src ${webview.cspSource} https: data:;
  ">
  <link href="${styleUri}" rel="stylesheet">
  <title>Code Historian Detail</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

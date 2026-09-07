declare module 'marked-terminal' {
  import type {MarkedExtension} from 'marked';

  export interface TerminalRendererOptions {
    width?: number;
    reflowText?: boolean;
    showSectionPrefix?: boolean;
    unescape?: boolean;
    emoji?: boolean;
    tab?: number;
  }

  export function markedTerminal(options?: TerminalRendererOptions): MarkedExtension;
}

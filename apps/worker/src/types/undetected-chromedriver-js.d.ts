// Type declarations for undetected-chromedriver-js
// This package doesn't ship its own types.

declare module 'undetected-chromedriver-js' {
  import { WebDriver } from 'selenium-webdriver';

  interface UndetectedChromeOptions {
    /** Run in headless mode (default: false) */
    headless?: boolean;
    /** Additional Chrome launch arguments */
    arguments?: string[];
    /** Path to Chrome binary */
    chromePath?: string;
  }

  class UndetectedChrome {
    constructor(options?: UndetectedChromeOptions);
    /** Build and return a patched Selenium WebDriver */
    build(): Promise<WebDriver>;
    /** Quit the browser and clean up */
    quit(): Promise<void>;
  }

  export default UndetectedChrome;
}

// ─────────────────────────────────────────────────────────────
// ESLint Rules — Banned Imports
//
// These rules enforce the v3 antidetect architecture by banning
// imports of deprecated browser automation libraries.
//
// If a developer imports puppeteer, selenium, or undetected-chromedriver,
// ESLint will throw an error at build time.
// ─────────────────────────────────────────────────────────────

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          // Puppeteer — replaced by Patchright
          {
            name: 'puppeteer',
            message: '🚫 puppeteer is BANNED. Use patchright instead. See: apps/worker/src/core/browser/patchright-launcher.ts',
          },
          {
            name: 'puppeteer-core',
            message: '🚫 puppeteer-core is BANNED. Use patchright instead.',
          },
          {
            name: 'puppeteer-extra',
            message: '🚫 puppeteer-extra is BANNED. Use patchright instead.',
          },
          {
            name: 'puppeteer-extra-plugin-stealth',
            message: '🚫 puppeteer-extra-plugin-stealth is BANNED. Patchright handles stealth natively.',
          },

          // Selenium — replaced by Patchright
          {
            name: 'selenium-webdriver',
            message: '🚫 selenium-webdriver is BANNED. Use patchright instead.',
          },

          // UndetectedChrome — replaced by Patchright
          {
            name: 'undetected-chromedriver-js',
            message: '🚫 undetected-chromedriver-js is BANNED. Use patchright instead.',
          },

          // Cheerio — replaced by curl-impersonate JSON API
          {
            name: 'cheerio',
            message: '🚫 cheerio is BANNED for scraping. TikTok closed public HTML in 2024. Use curl-impersonate JSON API instead.',
          },
        ],
        patterns: [
          {
            group: ['puppeteer*'],
            message: '🚫 All puppeteer packages are BANNED. Use patchright.',
          },
          {
            group: ['selenium*'],
            message: '🚫 All selenium packages are BANNED. Use patchright.',
          },
          {
            group: ['undetected-chromedriver*'],
            message: '🚫 All UC packages are BANNED. Use patchright.',
          },
        ],
      }],
    },
  },
];

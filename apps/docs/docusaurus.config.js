// @ts-check
// `@type` JSDoc annotations allow editor autocompletion and type checking
// For GitHub Pages: set BASE_URL and URL in CI (e.g. /repo-name/ and https://owner.github.io/repo-name/)
const config = {
  title: 'Agentron',
  tagline: 'Local-first platform for building and running AI agents',
  favicon: undefined,
  url: process.env.URL || 'https://agentos.dev',
  baseUrl: process.env.BASE_URL || '/',
  organizationName: 'agentos',
  projectName: 'agentos-studio',
  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },
  i18n: { defaultLocale: 'en', locales: ['en'] },
  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.js',
          editUrl: undefined,
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      },
    ],
  ],
  themeConfig: {
    githubRepo: process.env.GITHUB_REPO || 'agentos/agentos-studio',
    navbar: {
      title: 'Agentron',
      logo: { alt: 'Agentron', src: 'img/logo.svg' },
      items: [
        { type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Docs' },
        { to: '/download', label: 'Download', position: 'right' },
      ],
    },
    footer: { style: 'dark', copyright: 'Agentron' },
    prism: {},
  },
};

module.exports = config;

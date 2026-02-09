// @ts-check
// `@type` JSDoc annotations allow editor autocompletion and type checking
const config = {
  title: 'Agentron',
  tagline: 'Local-first platform for building and running AI agents',
  favicon: undefined,
  url: 'https://agentos.dev',
  baseUrl: '/',
  organizationName: 'agentos',
  projectName: 'agentos-studio',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
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
    navbar: {
      title: 'Agentron',
      logo: { alt: 'Agentron', src: 'img/logo.svg' },
      items: [{ type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Docs' }],
    },
    footer: { style: 'dark', copyright: 'Agentron' },
    prism: {},
  },
};

module.exports = config;

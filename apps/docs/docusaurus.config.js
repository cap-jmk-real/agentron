// @ts-check
// `@type` JSDoc annotations allow editor autocompletion and type checking
// For GitHub Pages: set BASE_URL and URL in CI (e.g. /repo-name/ and https://owner.github.io/repo-name/)
const config = {
  title: 'Agentron',
  tagline: 'Enterprise-ready local AI agent orchestration and workflow automation',
  favicon: undefined,
  url: process.env.URL || 'https://agentos.dev',
  baseUrl: process.env.BASE_URL || '/',
  organizationName: 'agentron-studio',
  projectName: 'agentron',
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
    metadata: [
      { name: 'description', content: 'Agentron: enterprise-ready local AI agent orchestration and workflow automation. Self-hosted, privacy-first multi-agent design and execution.' },
      { name: 'keywords', content: 'AI agent orchestration, local AI, workflow automation, multi-agent, local-first, self-hosted AI, agent automation, LLM orchestration, privacy-first AI' },
    ],
    githubRepo: process.env.GITHUB_REPO || 'agentron-studio/agentron',
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

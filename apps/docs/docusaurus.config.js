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
    colorMode: {
      defaultMode: 'light',
      respectPrefersColorScheme: true,
      disableSwitch: false,
    },
    navbar: {
      title: 'Agentron',
      logo: { alt: 'Agentron', src: 'img/logo.svg' },
      hideOnScroll: false,
      items: [
        { type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Docs' },
        { to: '/download', label: 'Download', position: 'right' },
        {
          href: process.env.GITHUB_REPO ? `https://github.com/${process.env.GITHUB_REPO}` : 'https://github.com/agentron-studio/agentron',
          position: 'right',
          className: 'navbar-github',
          'aria-label': 'GitHub',
        },
      ],
    },
    footer: {
      style: 'dark',
      copyright: `© ${new Date().getFullYear()} Agentron. Local-first AI orchestration.`,
      links: [
        {
          title: 'Get started',
          items: [
            { label: 'Introduction', to: '/' },
            { label: 'Download', to: '/download' },
            { label: 'Capabilities', to: '/capabilities' },
          ],
        },
        {
          title: 'Concepts',
          items: [
            { label: 'Agents', to: '/concepts/agents' },
            { label: 'Workflows', to: '/concepts/workflows' },
            { label: 'Tools', to: '/concepts/tools' },
            { label: 'Assistant', to: '/concepts/assistant' },
          ],
        },
        {
          title: 'Resources',
          items: [
            { label: 'GitHub', href: process.env.GITHUB_REPO ? `https://github.com/${process.env.GITHUB_REPO}` : 'https://github.com/agentron-studio/agentron' },
            { label: 'AI Guide', to: '/ai-guide' },
          ],
        },
      ],
    },
    prism: {},
  },
};

module.exports = config;

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docs: [
    'intro',
    'download',
    'podman-install',
    { type: 'category', label: 'Concepts', items: ['concepts/tools', 'concepts/agents', 'concepts/workflows', 'concepts/assistant'] },
    'capabilities',
    'ai-guide',
  ],
};

module.exports = sidebars;

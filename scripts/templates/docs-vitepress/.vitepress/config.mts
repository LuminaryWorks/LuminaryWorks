import { defineConfig } from 'vitepress'

export default defineConfig({
  title: '{{BRAND}}',
  description: '{{TAGLINE}}',
  lang: 'en-US',
  base: '/',
  cleanUrls: true,
  head: [['link', { rel: 'icon', href: '/favicon.ico' }]],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'GitHub', link: 'https://github.com/{{ORG}}/docs' },
    ],
    sidebar: [{ text: 'Guide', link: '/guide/' }],
    socialLinks: [{ icon: 'github', link: 'https://github.com/{{ORG}}' }],
    footer: {
      message: '{{BRAND}} · {{CHINESE}}',
      copyright: 'Copyright © {{YEAR}} {{BRAND}}',
    },
  },
})

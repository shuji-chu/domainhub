export type DemoDomain = {
  fqdn: string
  suffix: string
  note: string
  isDemo: true
}

export const demoSuffixes = ['全部后缀', '.com', '.net', '.org', '.xyz', '.top', '.site', '.online', '.tech']

export const demoDomains: DemoDomain[] = [
  { fqdn: 'mybrand.site', suffix: '.site', note: '示例域名 · 仅用于界面预览', isDemo: true },
  { fqdn: 'cloudbox.online', suffix: '.online', note: '示例域名 · 仅用于界面预览', isDemo: true },
  { fqdn: 'hello-world.xyz', suffix: '.xyz', note: '示例域名 · 仅用于界面预览', isDemo: true },
  { fqdn: 'fastnode.top', suffix: '.top', note: '示例域名 · 仅用于界面预览', isDemo: true },
  { fqdn: 'project.tech', suffix: '.tech', note: '示例域名 · 仅用于界面预览', isDemo: true },
]

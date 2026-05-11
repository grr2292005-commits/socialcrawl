export class ProxyManager {
  private static instance: ProxyManager;
  private proxies: string[] = [];

  private constructor() {
    const proxyList = process.env.PROXY_LIST;
    if (proxyList) {
      this.proxies = proxyList.split(',').map(p => p.trim()).filter(p => p.length > 0);
    }
  }

  public static getInstance(): ProxyManager {
    if (!ProxyManager.instance) {
      ProxyManager.instance = new ProxyManager();
    }
    return ProxyManager.instance;
  }

  public getProxy(): string | undefined {
    if (this.proxies.length === 0) return undefined;
    const randomIndex = Math.floor(Math.random() * this.proxies.length);
    return this.proxies[randomIndex];
  }
}

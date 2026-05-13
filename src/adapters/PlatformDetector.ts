export class PlatformDetector {
  public static detect(url: string): string {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      
      if (hostname.includes('linkedin.com')) return 'linkedin';
      
      return 'default';
    } catch (e) {
      return 'default';
    }
  }
}

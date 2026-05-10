export class PlatformDetector {
  public static detect(url: string): string {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      
      if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'twitter';
      if (hostname.includes('reddit.com')) return 'reddit';
      if (hostname.includes('linkedin.com')) return 'linkedin';
      if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube';
      if (hostname.includes('github.com')) return 'github';
      if (hostname.includes('tiktok.com')) return 'tiktok';
      if (hostname.includes('instagram.com')) return 'instagram';
      if (hostname.includes('facebook.com')) return 'facebook';
      if (hostname.includes('threads.net')) return 'threads';
      
      return 'default';
    } catch (e) {
      return 'default';
    }
  }
}

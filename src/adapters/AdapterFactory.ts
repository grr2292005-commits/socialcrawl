import { BaseAdapter } from './BaseAdapter';
import { DefaultAdapter } from './DefaultAdapter';
import { TwitterAdapter } from './TwitterAdapter';
import { PlatformDetector } from './PlatformDetector';

export class AdapterFactory {
  public static getAdapter(url: string, platformHint?: string): BaseAdapter {
    const platform = platformHint && platformHint !== 'default' 
      ? platformHint 
      : PlatformDetector.detect(url);

    switch (platform.toLowerCase()) {
      case 'twitter':
        return new TwitterAdapter();
      // Add other adapters here (Reddit, LinkedIn, etc.)
      default:
        return new DefaultAdapter();
    }
  }
}

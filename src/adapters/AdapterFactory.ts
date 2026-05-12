import { BaseAdapter } from './BaseAdapter';
import { DefaultAdapter } from './DefaultAdapter';
import { LinkedInAdapter } from './LinkedInAdapter';
import { PlatformDetector } from './PlatformDetector';

export class AdapterFactory {
  public static getAdapter(url: string, platformHint?: string): BaseAdapter {
    const platform = platformHint && platformHint !== 'default' 
      ? platformHint 
      : PlatformDetector.detect(url);

    if (platform === 'linkedin' || url.includes('linkedin.com')) {
      return new LinkedInAdapter();
    }

    switch (platform.toLowerCase()) {
      // Platform-specific adapters can be added here
      default:
        return new DefaultAdapter();
    }
  }
}

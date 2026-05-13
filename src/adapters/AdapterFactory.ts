import { BaseAdapter } from './BaseAdapter';
import { DefaultAdapter } from './DefaultAdapter';
import { PlatformDetector } from './PlatformDetector';

export class AdapterFactory {
  public static getAdapter(url: string, platformHint?: string): BaseAdapter {
    const platform = platformHint && platformHint !== 'default' 
      ? platformHint 
      : PlatformDetector.detect(url);

    switch (platform.toLowerCase()) {
      // Platform-specific adapters can be added here
      default:
        return new DefaultAdapter();
    }
  }
}

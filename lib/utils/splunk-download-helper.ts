import { SplunkConfig } from '../../config/splunk-config';

/**
 * Helper class for managing Splunk download URLs
 */
export class SplunkDownloadHelper {
  /**
   * Generate the correct Splunk download URL based on version
   * Handles different URL patterns for different Splunk versions
   */
  static getDownloadUrl(config: SplunkConfig): string {
    const baseUrl = 'https://download.splunk.com/products/splunk/releases';
    
    // For Splunk 10.x and later, use the new pattern with build ID
    if (config.splunkVersion.startsWith('10.') || parseFloat(config.splunkVersion) >= 10) {
      if (!config.splunkBuildId) {
        throw new Error(`Build ID is required for Splunk version ${config.splunkVersion}`);
      }
      return `${baseUrl}/${config.splunkVersion}/linux/splunk-${config.splunkVersion}-${config.splunkBuildId}-linux-amd64.tgz`;
    }
    
    // For Splunk 9.x and earlier, use the old pattern
    return `${baseUrl}/${config.splunkVersion}/linux/splunk-${config.splunkVersion}-Linux-x86_64.tgz`;
  }

  /**
   * Get the filename for the downloaded Splunk package
   */
  static getFilename(config: SplunkConfig): string {
    // For Splunk 10.x and later
    if (config.splunkVersion.startsWith('10.') || parseFloat(config.splunkVersion) >= 10) {
      if (!config.splunkBuildId) {
        throw new Error(`Build ID is required for Splunk version ${config.splunkVersion}`);
      }
      return `splunk-${config.splunkVersion}-${config.splunkBuildId}-linux-amd64.tgz`;
    }
    
    // For Splunk 9.x and earlier
    return `splunk-${config.splunkVersion}-Linux-x86_64.tgz`;
  }

  /**
   * Generate the UserData script for downloading and installing Splunk
   */
  static generateDownloadScript(config: SplunkConfig): string[] {
    const downloadUrl = config.splunkDownloadUrl || this.getDownloadUrl(config);
    const filename = this.getFilename(config);
    
    return [
      '# Download and install Splunk',
      'cd /opt',
      '',
      '# Set initial filename',
      `filename="${filename}"`,
      '',
      '# Check if download URL is accessible',
      `echo "Checking Splunk download URL: ${downloadUrl}"`,
      `if curl -f -I "${downloadUrl}" >/dev/null 2>&1; then`,
      `  echo "URL is accessible, downloading..."`,
      `  wget -O ${filename} "${downloadUrl}"`,
      `else`,
      `  echo "Primary URL not accessible, trying alternative patterns..."`,
      `  # Try without build ID for version 10.x`,
      `  ALT_URL="https://download.splunk.com/products/splunk/releases/${config.splunkVersion}/linux/splunk-${config.splunkVersion}-Linux-x86_64.tgz"`,
      `  if curl -f -I "$ALT_URL" >/dev/null 2>&1; then`,
      `    echo "Alternative URL found, downloading..."`,
      `    wget -O splunk-${config.splunkVersion}-Linux-x86_64.tgz "$ALT_URL"`,
      `    filename="splunk-${config.splunkVersion}-Linux-x86_64.tgz"`,
      `  else`,
      `    echo "ERROR: Unable to find valid Splunk download URL"`,
      `    echo "Tried: ${downloadUrl}"`,
      `    echo "Tried: $ALT_URL"`,
      `    exit 1`,
      `  fi`,
      `fi`,
      '',
      '# Verify filename variable is set',
      'if [ -z "$filename" ]; then',
      '  echo "ERROR: filename variable is not set"',
      '  exit 1',
      'fi',
      '',
      '# Extract Splunk package',
      'echo "Extracting Splunk from $filename"',
      `tar -xvzf "$filename"`,
      'if [ $? -ne 0 ]; then',
      '  echo "ERROR: Failed to extract Splunk package"',
      '  exit 1',
      'fi',
    ];
  }

  /**
   * Validate configuration and provide warnings
   */
  static validateConfig(config: SplunkConfig): void {
    const version = parseFloat(config.splunkVersion);
    
    if (version >= 10 && !config.splunkBuildId && !config.splunkDownloadUrl) {
      console.warn(`Warning: Splunk ${config.splunkVersion} typically requires a build ID. ` +
        `Consider adding 'splunkBuildId' to your configuration or providing a custom 'splunkDownloadUrl'.`);
    }
  }
}
import { SplunkConfig } from '../../config/splunk-config';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Helper class for managing Splunk Enterprise license installation
 */
export class LicenseHelper {
  private static readonly DEFAULT_LICENSE_DIR = './licenses';
  private static readonly LICENSE_FILE_PATTERN = /\.(xml|lic|License)$/i;

  /**
   * Check if license file exists in the local directory
   */
  static checkLocalLicense(config: SplunkConfig): { exists: boolean; path?: string; filename?: string } {
    if (config.licensePackageLocalPath) {
      // Check specific path from config
      const exists = fs.existsSync(config.licensePackageLocalPath);
      if (exists) {
        return {
          exists: true,
          path: config.licensePackageLocalPath,
          filename: path.basename(config.licensePackageLocalPath)
        };
      }
    }

    // Check default licenses directory
    const licensesDir = path.join(process.cwd(), this.DEFAULT_LICENSE_DIR);
    if (fs.existsSync(licensesDir)) {
      const files = fs.readdirSync(licensesDir);
      const licenseFile = files.find(file => this.LICENSE_FILE_PATTERN.test(file));
      
      if (licenseFile) {
        const fullPath = path.join(licensesDir, licenseFile);
        return {
          exists: true,
          path: fullPath,
          filename: licenseFile
        };
      }
    }

    return { exists: false };
  }

  /**
   * Display instructions for adding license file
   */
  static displayLicenseInstructions(config: SplunkConfig): void {
    const licensesDir = config.licensePackageLocalPath 
      ? path.dirname(config.licensePackageLocalPath)
      : this.DEFAULT_LICENSE_DIR;
    
    console.warn('\n' + '='.repeat(80));
    console.warn('⚠️  Splunk Enterprise License File Not Found');
    console.warn('='.repeat(80));
    console.warn('\nTo add a license file, follow these steps:\n');
    console.warn('1. Obtain a license file from Splunk');
    console.warn('2. Place the license file in the following directory:');
    console.warn(`   ${path.resolve(licensesDir)}/`);
    console.warn('3. Supported file formats:');
    console.warn('   - .xml (e.g., splunk-enterprise.xml)');
    console.warn('   - .lic (e.g., splunk-20gb.lic)');
    console.warn('   - .License (e.g., Splunk.License)');
    console.warn('\n' + '='.repeat(80) + '\n');
  }

  /**
   * Generate the installation script for license
   * This assumes the license file has been uploaded to the EC2 instance
   */
  static generateInstallScript(uploadedPath: string): string[] {
    return [
      '',
      '# Install Splunk Enterprise License',
      'echo "=== Installing Splunk Enterprise License ==="',
      `if [ -f "${uploadedPath}" ]; then`,
      '  echo "Found license file, installing..."',
      `  sudo -u splunk /opt/splunk/bin/splunk add licenses ${uploadedPath} -auth admin:$ADMIN_PASSWORD`,
      '  if [ $? -eq 0 ]; then',
      '    echo "✅ License installed successfully"',
      '    # List installed licenses',
      '    echo "=== Installed licenses ==="',
      '    sudo -u splunk /opt/splunk/bin/splunk list licenses -auth admin:$ADMIN_PASSWORD',
      '  else',
      '    echo "❌ ERROR: Failed to install license"',
      '    exit 1',
      '  fi',
      'else',
      '  echo "⚠️  WARNING: License file not found at ${uploadedPath}"',
      '  echo "⚠️  Continuing with trial license (60 days, 500MB/day)"',
      'fi',
      '',
    ];
  }

  /**
   * Generate commands to configure this instance as license master
   */
  static generateLicenseMasterScript(): string[] {
    return [
      '',
      '# Configure as License Master',
      'echo "=== Configuring as License Master ==="',
      '# License master configuration is automatic when license is installed',
      '# This instance will serve licenses to all other Splunk components',
      '',
    ];
  }

  /**
   * Generate commands for license peer configuration (for other components)
   */
  static generateLicensePeerScript(licenseMasterIp: string): string[] {
    return [
      '',
      '# Configure License Peer',
      'echo "=== Configuring License Peer ==="',
      `sudo -u splunk /opt/splunk/bin/splunk edit licenser-localpeer -manager_uri https://${licenseMasterIp}:8089 -auth admin:$ADMIN_PASSWORD`,
      'if [ $? -eq 0 ]; then',
      '  echo "✅ Configured as license peer successfully"',
      'else',
      '  echo "⚠️  WARNING: Failed to configure license peer"',
      '  echo "⚠️  You may need to configure this manually later"',
      'fi',
      '',
    ];
  }

  /**
   * Get the local license file information for CDK asset upload
   */
  static getLocalLicenseInfo(config: SplunkConfig): { path: string; filename: string } | null {
    const licenseInfo = this.checkLocalLicense(config);
    
    if (licenseInfo.exists && licenseInfo.path && licenseInfo.filename) {
      return {
        path: licenseInfo.path,
        filename: licenseInfo.filename
      };
    }
    
    return null;
  }

  /**
   * Check if license installation is enabled
   */
  static isLicenseInstallEnabled(config: SplunkConfig): boolean {
    return config.enableLicenseInstall === true;
  }
}
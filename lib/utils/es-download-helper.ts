import { SplunkConfig } from '../../config/splunk-config';
import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';

/**
 * Helper class for managing Splunk Enterprise Security (ES) download and installation
 */
export class ESDownloadHelper {
  private static readonly DEFAULT_ES_PACKAGE_DIR = './packages';
  private static readonly ES_PACKAGE_PATTERN = /splunk-(es-|enterprise-security).*\.(tgz|tar\.gz|spl)$/i;

  /**
   * Check if ES package exists in the local directory
   */
  static checkLocalPackage(config: SplunkConfig): { exists: boolean; path?: string; filename?: string } {
    if (config.esPackageLocalPath) {
      // Check specific path from config
      const exists = fs.existsSync(config.esPackageLocalPath);
      if (exists) {
        return {
          exists: true,
          path: config.esPackageLocalPath,
          filename: path.basename(config.esPackageLocalPath)
        };
      }
    }

    // Check default packages directory
    const packagesDir = path.join(process.cwd(), this.DEFAULT_ES_PACKAGE_DIR);
    if (fs.existsSync(packagesDir)) {
      const files = fs.readdirSync(packagesDir);
      const esPackage = files.find(file => this.ES_PACKAGE_PATTERN.test(file));
      
      if (esPackage) {
        const fullPath = path.join(packagesDir, esPackage);
        return {
          exists: true,
          path: fullPath,
          filename: esPackage
        };
      }
    }

    return { exists: false };
  }

  /**
   * Display instructions for downloading ES package
   */
  static displayDownloadInstructions(config: SplunkConfig): void {
    const packagesDir = config.esPackageLocalPath 
      ? path.dirname(config.esPackageLocalPath)
      : this.DEFAULT_ES_PACKAGE_DIR;

    console.warn('\n' + '='.repeat(80));
    console.warn('⚠️  Splunk Enterprise Security Package Not Found');
    console.warn('='.repeat(80));
    console.warn('\nTo prepare the ES package, follow these steps:\n');
    console.warn('1. Download ES from Splunkbase (https://splunkbase.splunk.com/app/263)');
    console.warn('2. Place the downloaded file in the following directory:');
    console.warn(`   ${path.resolve(packagesDir)}/`);
    console.warn('3. Example filename: splunk-es-8.1.1.tgz');
    console.warn('\n' + '='.repeat(80) + '\n');
  }

  /**
   * Validate ES configuration and check for required files
   */
  static validateConfig(config: SplunkConfig): void {
    if (!config.enableEnterpriseSecurity) {
      return;
    }

    const packageInfo = this.checkLocalPackage(config);
    
    if (!packageInfo.exists) {
      this.displayDownloadInstructions(config);
      throw new Error('Enterprise Security package not found. Please follow the instructions above to add the package.');
    }

    console.log(`✅ ES package found: ${packageInfo.filename}`);
  }

  /**
   * Generate the installation script for ES
   * This assumes the package has been uploaded to the EC2 instance
   */
  static generateInstallScript(config: SplunkConfig, uploadedPath: string): string[] {
    return [
      '',
      '# Install Enterprise Security',
      'echo "=== Starting Enterprise Security Installation ==="',
      '',
      '# Temporarily disable exit on error for ES installation',
      'set +e',
      '',
      `if [ -f "${uploadedPath}" ]; then`,
      '  echo "Found ES package at ${uploadedPath}"',
      '  echo "Installing Enterprise Security..."',
      '  ',
      '  # Ensure Splunk is running before installing ES (required for app installation)',
      '  if ! pgrep -f splunkd > /dev/null; then',
      '    echo "Splunk is not running, starting it first..."',
      '    sudo -u splunk /opt/splunk/bin/splunk start',
      '    sleep 10',
      '  fi',
      '  ',
      '  # Install ES package while Splunk is running',
      `  sudo -u splunk /opt/splunk/bin/splunk install app ${uploadedPath} -auth admin:$ADMIN_PASSWORD`,
      '  ES_INSTALL_RESULT=$?',
      '  ',
      '  if [ $ES_INSTALL_RESULT -eq 0 ]; then',
      '    echo "✅ Enterprise Security installed successfully"',
      '    ',
      '    # Configure ES-specific settings',
      '    echo "Configuring ES-specific settings..."',
      '    sudo -u splunk /opt/splunk/bin/splunk set servername es-search-head -auth admin:$ADMIN_PASSWORD || echo "Warning: Failed to set servername"',
      '    sudo -u splunk /opt/splunk/bin/splunk set default-hostname es-search-head -auth admin:$ADMIN_PASSWORD || echo "Warning: Failed to set hostname"',
      '    ',
      '    # Restart Splunk to apply ES configuration',
      '    echo "Restarting Splunk to apply ES configuration..."',
      '    sudo -u splunk /opt/splunk/bin/splunk restart',
      '    echo "Waiting for Splunk to restart with ES..."',
      '    sleep 30',
      '  else',
      '    echo "❌ ERROR: Failed to install Enterprise Security (exit code: $ES_INSTALL_RESULT)"',
      '    echo "ES installation failed but Splunk is running. Manual ES installation will be required."',
      '  fi',
      'else',
      '  echo "❌ ERROR: ES package not found at ${uploadedPath}"',
      '  echo "ES will need to be installed manually after deployment"',
      'fi',
      '',
      '# Re-enable exit on error',
      'set -e',
      '',
      '# Ensure Splunk is running',
      'if ! pgrep -f splunkd > /dev/null; then',
      '  echo "Splunk is not running, attempting to start..."',
      '  sudo -u splunk /opt/splunk/bin/splunk start',
      'fi',
      '',
    ];
  }

  /**
   * Get the local ES package information for CDK asset upload
   */
  static getLocalPackageInfo(config: SplunkConfig): { path: string; filename: string } | null {
    const packageInfo = this.checkLocalPackage(config);
    
    if (packageInfo.exists && packageInfo.path && packageInfo.filename) {
      return {
        path: packageInfo.path,
        filename: packageInfo.filename
      };
    }
    
    return null;
  }

  /**
   * Generate UserData commands for checking ES installation
   */
  static generateHealthCheckScript(): string[] {
    return [
      '',
      '# Check ES installation',
      'if sudo -u splunk /opt/splunk/bin/splunk list app -auth admin:$ADMIN_PASSWORD | grep -q "SplunkEnterpriseSecuritySuite"; then',
      '  echo "Enterprise Security is installed and active"',
      'else',
      '  echo "WARNING: Enterprise Security is not installed or not active"',
      'fi',
      '',
    ];
  }
}
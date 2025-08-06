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
    console.warn('⚠️  Splunk Enterprise Security パッケージが見つかりません');
    console.warn('='.repeat(80));
    console.warn('\n以下の手順でESパッケージを準備してください：\n');
    console.warn('1. Splunkbase (https://splunkbase.splunk.com/app/263) からES をダウンロード');
    console.warn('2. ダウンロードしたファイルを以下のディレクトリに配置:');
    console.warn(`   ${path.resolve(packagesDir)}/`);
    console.warn('3. ファイル名の例: splunk-es-8.1.1.tgz');
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
      throw new Error('Enterprise Securityパッケージが見つかりません。上記の手順に従ってパッケージを配置してください。');
    }

    console.log(`✅ ESパッケージが見つかりました: ${packageInfo.filename}`);
  }

  /**
   * Generate the installation script for ES
   * This assumes the package has been uploaded to the EC2 instance
   */
  static generateInstallScript(config: SplunkConfig, uploadedPath: string): string[] {
    return [
      '',
      '# Install Enterprise Security',
      'echo "Installing Splunk Enterprise Security..."',
      `if [ -f "${uploadedPath}" ]; then`,
      `  sudo -u splunk /opt/splunk/bin/splunk install app ${uploadedPath} -auth admin:$ADMIN_PASSWORD`,
      '  if [ $? -eq 0 ]; then',
      '    echo "Enterprise Security installed successfully"',
      '    # Configure ES-specific settings',
      '    sudo -u splunk /opt/splunk/bin/splunk set servername es-search-head -auth admin:$ADMIN_PASSWORD',
      '    /opt/splunk/bin/splunk set default-hostname es-search-head -auth admin:$ADMIN_PASSWORD',
      '  else',
      '    echo "ERROR: Failed to install Enterprise Security"',
      '    exit 1',
      '  fi',
      'else',
      '  echo "ERROR: ES package not found at ${uploadedPath}"',
      '  exit 1',
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
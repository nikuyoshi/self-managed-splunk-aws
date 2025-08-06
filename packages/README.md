# Splunk Application Package Directory

**[English](#english)** | **[日本語](#日本語)**

---

## English

Place Splunk application package files (Enterprise Security, etc.) in this directory.

### Enterprise Security (ES) Download Instructions

1. Visit [Splunkbase](https://splunkbase.splunk.com/app/263)
2. Log in with your Splunk account (ES license required)
3. Download the latest version of Splunk Enterprise Security
4. Place the downloaded file (e.g., `splunk-es-8.1.1.tgz`) in this directory

### File Name Examples

#### Enterprise Security
- `splunk-es-8.1.1.tgz`
- `splunk-es-8.0.0.tar.gz`
- `SplunkEnterpriseSecuritySuite-8.1.1.spl`
- `splunk-enterprise-security_811.spl`

#### Other Splunk Apps
- Other Splunk applications can be placed in this directory in the future

### Important Notes

- Package files are not included in the Git repository due to their large size
- Place required packages before deployment
- License files should be placed in the `../licenses/` directory

---

## 日本語

このディレクトリにSplunkアプリケーション（Enterprise Security等）のパッケージファイルを配置してください。

### Enterprise Security (ES) ダウンロード手順

1. [Splunkbase](https://splunkbase.splunk.com/app/263) にアクセス
2. Splunkアカウントでログイン（ESライセンスが必要）
3. 最新版のSplunk Enterprise Securityをダウンロード
4. ダウンロードしたファイル（例: `splunk-es-8.1.1.tgz`）をこのディレクトリに配置

### ファイル名の例

#### Enterprise Security
- `splunk-es-8.1.1.tgz`
- `splunk-es-8.0.0.tar.gz`
- `SplunkEnterpriseSecuritySuite-8.1.1.spl`
- `splunk-enterprise-security_811.spl`

#### その他のSplunkアプリ
- 将来的に他のSplunkアプリケーションもこのディレクトリに配置可能です

### 注意事項

- パッケージファイルは大きなファイルのため、Gitリポジトリには含めません
- デプロイ前に必要なパッケージを配置してください
- ライセンスファイルは `../licenses/` ディレクトリに配置してください
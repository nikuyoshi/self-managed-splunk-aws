# Splunk Enterprise License Directory

**[English](#english)** | **[日本語](#日本語)**

---

## English

Place your Splunk Enterprise license files in this directory.

### Supported File Formats

- `.xml` - Standard XML format license file
- `.lic` - Short format license file
- `.License` - Splunk license file (e.g., `Splunk.License`)

### File Name Examples

- `splunk-enterprise.xml`
- `splunk-20gb.lic`
- `Splunk.License`
- `SplunkEnterprise.License`

### Deployment Steps

1. Obtain license file from Splunk
2. Place license file in this directory
3. Set `enableLicenseInstall: true` in `config/splunk-config.ts`
4. Deploy CDK stacks

### Important Notes

- Do not commit license files to Git repository as they are confidential
- `*.xml`, `*.lic`, `*.License` are added to `.gitignore`
- License will be automatically installed on Cluster Manager, and other components will be configured as license peers
- No license file needed when using trial version (60 days, 500MB/day)

---

## 日本語

このディレクトリにSplunk Enterpriseのライセンスファイルを配置してください。

### サポートされるファイル形式

- `.xml` - 標準的なXML形式のライセンスファイル
- `.lic` - ライセンスファイルの短縮形式
- `.License` - Splunkライセンスファイル（例: `Splunk.License`）

### ファイル名の例

- `splunk-enterprise.xml`
- `splunk-20gb.lic`
- `Splunk.License`
- `SplunkEnterprise.License`

### 配置手順

1. Splunkからライセンスファイルを入手
2. このディレクトリにライセンスファイルを配置
3. `config/splunk-config.ts`で`enableLicenseInstall: true`に設定
4. CDKスタックをデプロイ

### 注意事項

- ライセンスファイルは機密情報のため、Gitリポジトリにはコミットしないでください
- `.gitignore`に`*.xml`、`*.lic`、`*.License`が追加されています
- ライセンスはCluster Managerに自動的にインストールされ、他のコンポーネントはライセンスピアとして設定されます
- 試用版（60日間、500MB/日）を使用する場合は、ライセンスファイルの配置は不要です
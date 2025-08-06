# Splunk Enterprise License Directory

このディレクトリにSplunk Enterpriseのライセンスファイルを配置してください。

## サポートされるファイル形式

- `.xml` - 標準的なXML形式のライセンスファイル
- `.lic` - ライセンスファイルの短縮形式
- `.License` - Splunkライセンスファイル（例: `Splunk.License`）

## ファイル名の例

- `splunk-enterprise.xml`
- `splunk-20gb.lic`
- `Splunk.License`
- `SplunkEnterprise.License`

## 配置手順

1. Splunkからライセンスファイルを入手
2. このディレクトリにライセンスファイルを配置
3. `config/splunk-config.ts`で`enableLicenseInstall: true`に設定
4. CDKスタックをデプロイ

## 注意事項

- ライセンスファイルは機密情報のため、Gitリポジトリにはコミットしないでください
- `.gitignore`に`*.xml`、`*.lic`、`*.License`が追加されています
- ライセンスはCluster Managerに自動的にインストールされ、他のコンポーネントはライセンスピアとして設定されます
- 試用版（60日間、500MB/日）を使用する場合は、ライセンスファイルの配置は不要です
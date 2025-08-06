# Splunk アプリケーションパッケージディレクトリ

このディレクトリにSplunkアプリケーション（Enterprise Security等）のパッケージファイルを配置してください。

## Enterprise Security (ES) ダウンロード手順

1. [Splunkbase](https://splunkbase.splunk.com/app/263) にアクセス
2. Splunkアカウントでログイン（ESライセンスが必要）
3. 最新版のSplunk Enterprise Securityをダウンロード
4. ダウンロードしたファイル（例: `splunk-es-8.1.1.tgz`）をこのディレクトリに配置

## ファイル名の例

### Enterprise Security
- `splunk-es-8.1.1.tgz`
- `splunk-es-8.0.0.tar.gz`
- `SplunkEnterpriseSecuritySuite-8.1.1.spl`
- `splunk-enterprise-security_811.spl`

### その他のSplunkアプリ
- 将来的に他のSplunkアプリケーションもこのディレクトリに配置可能です

## 注意事項

- パッケージファイルは大きなファイルのため、Gitリポジトリには含めません
- デプロイ前に必要なパッケージを配置してください
- ライセンスファイルは `../licenses/` ディレクトリに配置してください
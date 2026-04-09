# 既存Search HeadインスタンスへのLet's Encrypt証明書適用ガイド

## 概要

このガイドでは、EC2インスタンスを再作成することなく、既存のSearch HeadインスタンスにLet's Encrypt証明書を適用する方法を説明します。

[sslip.io](https://sslip.io) の無料ワイルドカードDNSサービスと Let's Encrypt を組み合わせることで、独自ドメインなしでブラウザ警告のないHTTPSを実現します。

**アクセスURL例:**
- Search Head: `https://<ELASTIC-IP-DASHES>.sslip.io:8443`
- ES Search Head: `https://<ES-ELASTIC-IP-DASHES>.sslip.io:8443`

## 前提条件

- AWS CLIが設定済み
- 適切なAWSプロファイルが設定済み
- インスタンスにSSM Agentがインストール済み（Amazon Linux 2023はデフォルトでインストール済み）
- Let's Encrypt証明書登録用のメールアドレス
- ローカル環境に `jq` がインストール済み

## apply-letsencrypt-to-existing.sh の実行

CloudFormationスタックタグからインスタンスIDを自動検出し、すべてのSearch Headに一括適用します。

```bash
./scripts/apply-letsencrypt-to-existing.sh \
  --email your-email@example.com \
  --profile <your-aws-profile> \
  --region us-west-2
```

### オプション

| オプション | 説明 | デフォルト |
|---|---|---|
| `--email` | Let's Encrypt登録メールアドレス（必須） | - |
| `--profile` | AWSプロファイル名（省略可） | デフォルト認証情報 |
| `--region` | AWSリージョン | `us-west-2` |

### スクリプトの動作

1. `SelfManagedSplunk-SearchHead` / `SelfManagedSplunk-ES` スタックのタグからインスタンスIDを自動検出
2. 証明書セットアップスクリプトをbase64エンコードしてSSM Run Commandで各インスタンスに送信
3. 各インスタンスで以下を実行:
   - certbotのインストール
   - Let's Encrypt HTTP-01チャレンジ用にポート80を一時開放
   - Splunkを停止して証明書を取得
   - ポート80を閉鎖
   - Splunk `web.conf` をHTTPS（ポート8443）に設定して再起動
   - 90日ごとの自動更新cronジョブを設定
4. 完了後にアクセスURL（sslip.io ドメイン）を表示

### 実行状況の確認

```bash
# SSM Run Command の結果を確認
aws ssm get-command-invocation \
  --command-id <command-id> \
  --instance-id <instance-id> \
  --profile <your-aws-profile> \
  --region us-west-2
```

## 動作確認

証明書取得後、sslip.io ドメインでアクセスします（ブラウザ警告なし）。

```bash
# パブリックIPからドメインを生成（ドット → ダッシュ変換）
PUBLIC_IP=$(aws ec2 describe-instances \
  --instance-ids <instance-id> \
  --query "Reservations[0].Instances[0].PublicIpAddress" \
  --output text \
  --profile <your-aws-profile> --region us-west-2)
DOMAIN="${PUBLIC_IP//./-}.sslip.io"

# HTTPSアクセスを確認
curl -s -o /dev/null -w "%{http_code}" https://$DOMAIN:8443
```

ブラウザから `https://<ELASTIC-IP-DASHES>.sslip.io:8443` にアクセスして確認してください。

## トラブルシューティング

### ポート80が使用中の場合

Let's Encrypt の HTTP-01 チャレンジにはポート80が必要です。他のプロセスが使用している場合は停止してください。

### セキュリティグループでポート80が閉じている場合

スクリプト内で自動的にポート80を一時開放しますが、失敗した場合は手動で対応してください。

```bash
SG_ID=$(aws ec2 describe-instances \
  --instance-ids <instance-id> \
  --query "Reservations[0].Instances[0].SecurityGroups[0].GroupId" \
  --output text \
  --profile <your-aws-profile> --region us-west-2)

# 一時的にポート80を開放
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID --protocol tcp --port 80 --cidr 0.0.0.0/0 \
  --profile <your-aws-profile> --region us-west-2

# 証明書取得後に閉鎖
aws ec2 revoke-security-group-ingress \
  --group-id $SG_ID --protocol tcp --port 80 --cidr 0.0.0.0/0 \
  --profile <your-aws-profile> --region us-west-2
```

### 証明書のレート制限に達した場合

Let's Encrypt には発行制限（同一ドメインに対して7日間で5枚）があります。sslip.io はドメイン共有のため制限が厳しい場合があります。時間をおいて再試行してください。

### Splunkが証明書を読めない場合

```bash
# インスタンスに接続して確認
aws ssm start-session --target <instance-id> --profile <your-aws-profile> --region us-west-2

# 証明書ファイルのパーミッション確認
ls -la /etc/letsencrypt/live/*/
ls -la /opt/splunk/etc/auth/letsencrypt/

# Splunkのログを確認
tail -50 /opt/splunk/var/log/splunk/splunkd.log | grep -i ssl

# web.confを確認
cat /opt/splunk/etc/system/local/web.conf
```

## ロールバック手順

HTTPSを無効にして元のHTTPに戻す場合：

```bash
# インスタンスに接続
aws ssm start-session --target <instance-id> --profile <your-aws-profile> --region us-west-2

# web.confを削除してHTTPに戻す
sudo -u splunk rm -f /opt/splunk/etc/system/local/web.conf

# Splunkを再起動
sudo -u splunk /opt/splunk/bin/splunk restart
```

## 証明書の自動更新

スクリプト適用後、以下のcronジョブが設定されます：

```cron
0 0,12 * * * root certbot renew --quiet \
    --deploy-hook "chmod 644 /etc/letsencrypt/archive/*/privkey*.pem && sudo -u splunk /opt/splunk/bin/splunk restart"
```

Let's Encrypt証明書の有効期限は90日ですが、このcronジョブにより自動的に更新されます。

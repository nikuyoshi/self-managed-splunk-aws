# Splunk Indexer Cluster Troubleshooting Guide

[English](#english) | [日本語](#japanese)

<a name="english"></a>
## English

### Common Issues and Solutions

### 1. Indexer Fails to Join Cluster

**Note:** Recent improvements to the UserData scripts have significantly reduced this issue. The scripts now include:
- Automatic Cluster Manager availability checking (5-minute wait)
- Retry logic (3 attempts with 30-second intervals)
- Improved error handling to ensure script completion

**Symptoms:**
- Indexer instance is running but not appearing in cluster status
- Error message: "Could not contact manager"
- Cluster shows fewer peers than expected

**Quick Check:**
```bash
# On Cluster Manager
/opt/splunk/bin/splunk show cluster-status -auth admin:<password>

# On problematic Indexer
/opt/splunk/bin/splunk list cluster-config -auth admin:<password>
```

**Solution Steps:**

1. **Connect to the Indexer**
   ```bash
   aws ssm start-session --target <indexer-instance-id> --region us-west-2
   ```

2. **Check UserData execution logs**
   ```bash
   # Look for cluster join attempts
   tail -200 /var/log/cloud-init-output.log | grep -A 10 -B 10 "cluster"
   
   # Check for errors
   grep -E "ERROR|Failed|fail" /var/log/cloud-init-output.log
   ```

3. **Verify Splunk is running**
   ```bash
   # init.d方式でサービス状態を確認
   /etc/init.d/splunk status
   # または直接Splunkコマンドで確認
   /opt/splunk/bin/splunk status
   ```

4. **Check current cluster configuration**
   ```bash
   # Get admin password
   ADMIN_PASSWORD=$(aws secretsmanager get-secret-value \
     --secret-id <secret-arn> \
     --query 'SecretString' --output text \
     --region us-west-2 | jq -r '.password')
   
   # Check config
   /opt/splunk/bin/splunk list cluster-config -auth admin:$ADMIN_PASSWORD
   ```

5. **Manually join the cluster**
   ```bash
   # Configure as peer
   /opt/splunk/bin/splunk edit cluster-config \
     -mode peer \
     -manager_uri https://<cluster-manager-ip>:8089 \
     -replication_port 9100 \
     -secret clustersecret \
     -auth admin:$ADMIN_PASSWORD
   
   # Restart Splunk
   /opt/splunk/bin/splunk restart
   
   # Wait 30 seconds
   sleep 30
   
   # Verify
   /opt/splunk/bin/splunk show cluster-member-info -auth admin:$ADMIN_PASSWORD
   ```

### 2. Cluster Manager Not Ready

**Symptoms:**
- Indexers show "Waiting for Cluster Manager" in logs
- Cluster Manager instance is running but not responding

**Solution:**
1. Check Cluster Manager status
2. Ensure security groups allow port 8089 between instances
3. Verify Cluster Manager IP is correct in Indexer configuration

### 3. Replication Issues

**Symptoms:**
- Cluster status shows "Replication factor not met"
- Buckets stuck in "PendingFixup" state

**Solution:**
```bash
# On Cluster Manager - check fixup status
/opt/splunk/bin/splunk show cluster-status --verbose -auth admin:<password>

# Force bucket roll
/opt/splunk/bin/splunk rolling-restart cluster-peers -auth admin:<password>
```

### 4. Authentication Failures

**Symptoms:**
- "Login failed" errors in logs
- Cannot retrieve admin password

**Solution:**
1. Verify IAM role has Secrets Manager access
2. Check region is correct
3. Manually retrieve password:
   ```bash
   aws secretsmanager get-secret-value \
     --secret-id <secret-arn> \
     --region us-west-2
   ```

## Preventive Measures

### During Deployment

1. **Deploy in correct order:**
   - Network stack first
   - Cluster Manager must be fully ready
   - Then deploy Indexers
   - Finally Search Heads

2. **Monitor CloudFormation events:**
   ```bash
   aws cloudformation describe-stack-events \
     --stack-name SelfManagedSplunk-IndexerCluster \
     --region us-west-2
   ```

### Post-Deployment Verification

Run these commands after deployment:

```bash
# 1. List all instances
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=*SelfManagedSplunk*" \
  "Name=instance-state-name,Values=running" \
  --query "Reservations[*].Instances[*].{Name:Tags[?Key=='Name']|[0].Value,InstanceId:InstanceId,PrivateIp:PrivateIpAddress}" \
  --output table

# 2. Check cluster status (on Cluster Manager)
/opt/splunk/bin/splunk show cluster-status -auth admin:<password>

# 3. Verify Search Head sees all Indexers
/opt/splunk/bin/splunk list search-server -auth admin:<password>
```

## Emergency Recovery Script

Save this script on each Indexer for emergency use:

```bash
#!/bin/bash
# /home/ec2-user/fix-cluster.sh

# Get region and cluster manager IP from metadata
REGION=$(ec2-metadata --availability-zone | cut -d' ' -f2 | sed 's/.$//')
CLUSTER_MANAGER_IP="10.0.3.143"  # Update with actual IP

# Get admin password
ADMIN_PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id "SplunkAdminPassword*" \
  --query 'SecretString' --output text \
  --region $REGION | jq -r '.password')

# Join cluster
/opt/splunk/bin/splunk edit cluster-config \
  -mode peer \
  -manager_uri https://$CLUSTER_MANAGER_IP:8089 \
  -replication_port 9100 \
  -secret clustersecret \
  -auth admin:$ADMIN_PASSWORD

# Restart
/opt/splunk/bin/splunk restart

echo "Cluster join attempted. Check status with:"
echo "/opt/splunk/bin/splunk show cluster-member-info -auth admin:$ADMIN_PASSWORD"
```

## Distributed Search Troubleshooting

### Search Head Shows "(no servers)"

**Symptoms:**
- `/opt/splunk/bin/splunk list search-server` returns "(no servers)"
- Search results only show local data
- No indexer data visible in searches

**Solution:**

1. **Check UserData log for distributed search script execution**
   ```bash
   # Look for distributed search configuration
   sudo grep -A 50 "Configure distributed search" /var/log/cloud-init-output.log
   
   # Check for errors
   sudo grep "integer expression expected" /var/log/cloud-init-output.log
   ```

2. **Manually configure distributed search**
   ```bash
   # Get admin password
   ADMIN_PASSWORD=$(aws secretsmanager get-secret-value \
     --secret-id <secret-arn> \
     --query 'SecretString' --output text \
     --region us-west-2 | jq -r '.password')
   
   # Add each indexer as search server
   /opt/splunk/bin/splunk add search-server https://10.0.3.234:8089 \
     -auth admin:$ADMIN_PASSWORD \
     -remoteUsername admin -remotePassword $ADMIN_PASSWORD
   
   /opt/splunk/bin/splunk add search-server https://10.0.4.183:8089 \
     -auth admin:$ADMIN_PASSWORD \
     -remoteUsername admin -remotePassword $ADMIN_PASSWORD
   
   /opt/splunk/bin/splunk add search-server https://10.0.5.253:8089 \
     -auth admin:$ADMIN_PASSWORD \
     -remoteUsername admin -remotePassword $ADMIN_PASSWORD
   ```

3. **Verify configuration**
   ```bash
   # List configured search servers
   /opt/splunk/bin/splunk list search-server -auth admin:$ADMIN_PASSWORD
   
   # Test distributed search
   /opt/splunk/bin/splunk search "index=_internal | stats count by splunk_server" \
     -auth admin:$ADMIN_PASSWORD
   ```

### Known Issue: grep -c Multiple Line Output

**Fixed in latest version**: The UserData script now properly handles grep -c output that may contain multiple lines by using `head -1 | tr -d '\n'`.

## When to Contact Support

Escalate if you see:
- Persistent data loss warnings
- Cluster member with status "GracefulShutdown" for >10 minutes
- Search heads unable to search after cluster join verification
- Repeated automatic restarts in splunkd.log

## Useful Log Locations

- **UserData execution**: `/var/log/cloud-init-output.log`
- **Splunk daemon**: `/opt/splunk/var/log/splunk/splunkd.log`
- **Cluster operations**: `/opt/splunk/var/log/splunk/splunkd.log` (grep for "CMPeer")
- **Search issues**: `/opt/splunk/var/log/splunk/metrics.log`

---

<a name="japanese"></a>
## 日本語

### よくある問題と解決方法

### 1. インデクサーがクラスターに参加できない

**注記:** UserDataスクリプトの最近の改善により、この問題は大幅に減少しました。スクリプトには以下が含まれています：
- Cluster Managerの可用性自動チェック（5分間待機）
- リトライロジック（30秒間隔で3回試行）
- スクリプトの完全実行を保証する改善されたエラーハンドリング

**症状:**
- インデクサーインスタンスは実行中だがクラスターステータスに表示されない
- エラーメッセージ: "Could not contact manager"
- クラスターが期待されるピア数より少ない

**簡易チェック:**
```bash
# クラスターマネージャーで実行
/opt/splunk/bin/splunk show cluster-status -auth admin:<password>

# 問題のあるインデクサーで実行
/opt/splunk/bin/splunk list cluster-config -auth admin:<password>
```

**解決手順:**

1. **インデクサーに接続**
   ```bash
   aws ssm start-session --target <indexer-instance-id> --region us-west-2
   ```

2. **UserData実行ログを確認**
   ```bash
   # クラスター参加の試行を確認
   tail -200 /var/log/cloud-init-output.log | grep -A 10 -B 10 "cluster"
   
   # エラーを確認
   grep -E "ERROR|Failed|fail" /var/log/cloud-init-output.log
   ```

3. **Splunkが実行中か確認**
   ```bash
   # init.d方式でサービス状態を確認
   /etc/init.d/splunk status
   # または直接Splunkコマンドで確認
   /opt/splunk/bin/splunk status
   ```

4. **現在のクラスター設定を確認**
   ```bash
   # 管理者パスワードを取得
   ADMIN_PASSWORD=$(aws secretsmanager get-secret-value \
     --secret-id <secret-arn> \
     --query 'SecretString' --output text \
     --region us-west-2 | jq -r '.password')
   
   # 設定を確認
   /opt/splunk/bin/splunk list cluster-config -auth admin:$ADMIN_PASSWORD
   ```

5. **手動でクラスターに参加**
   ```bash
   # ピアとして設定
   /opt/splunk/bin/splunk edit cluster-config \
     -mode peer \
     -manager_uri https://<cluster-manager-ip>:8089 \
     -replication_port 9100 \
     -secret clustersecret \
     -auth admin:$ADMIN_PASSWORD
   
   # Splunkを再起動
   /opt/splunk/bin/splunk restart
   
   # 30秒待機
   sleep 30
   
   # 確認
   /opt/splunk/bin/splunk show cluster-member-info -auth admin:$ADMIN_PASSWORD
   ```

### 2. クラスターマネージャーが準備できていない

**症状:**
- インデクサーのログに "Waiting for Cluster Manager" と表示
- クラスターマネージャーインスタンスは実行中だが応答しない

**解決方法:**
1. クラスターマネージャーのステータスを確認
2. インスタンス間でポート8089が許可されているかセキュリティグループを確認
3. インデクサー設定でクラスターマネージャーのIPが正しいか確認

### 3. レプリケーションの問題

**症状:**
- クラスターステータスに "Replication factor not met" と表示
- バケットが "PendingFixup" 状態で停止

**解決方法:**
```bash
# クラスターマネージャーで詳細ステータスを確認
/opt/splunk/bin/splunk show cluster-status --verbose -auth admin:<password>

# バケットの強制ロール
/opt/splunk/bin/splunk rolling-restart cluster-peers -auth admin:<password>
```

### 4. 認証エラー

**症状:**
- ログに "Login failed" エラー
- 管理者パスワードを取得できない

**解決方法:**
1. IAMロールにSecrets Managerアクセス権限があるか確認
2. リージョンが正しいか確認
3. パスワードを手動で取得:
   ```bash
   aws secretsmanager get-secret-value \
     --secret-id <secret-arn> \
     --region us-west-2
   ```

## 予防策

### デプロイ時の注意点

1. **正しい順序でデプロイ:**
   - ネットワークスタックを最初に
   - クラスターマネージャーが完全に準備完了するまで待つ
   - その後インデクサーをデプロイ
   - 最後にサーチヘッド

2. **CloudFormationイベントを監視:**
   ```bash
   aws cloudformation describe-stack-events \
     --stack-name SelfManagedSplunk-IndexerCluster \
     --region us-west-2
   ```

### デプロイ後の確認

デプロイ後に以下のコマンドを実行:

```bash
# 1. すべてのインスタンスをリスト
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=*SelfManagedSplunk*" \
  "Name=instance-state-name,Values=running" \
  --query "Reservations[*].Instances[*].{Name:Tags[?Key=='Name']|[0].Value,InstanceId:InstanceId,PrivateIp:PrivateIpAddress}" \
  --output table

# 2. クラスターステータスを確認（クラスターマネージャーで）
/opt/splunk/bin/splunk show cluster-status -auth admin:<password>

# 3. サーチヘッドがすべてのインデクサーを認識しているか確認
/opt/splunk/bin/splunk list search-server -auth admin:<password>
```

## 緊急回復スクリプト

各インデクサーに緊急時用のスクリプトを保存:

```bash
#!/bin/bash
# /home/ec2-user/fix-cluster.sh

# メタデータからリージョンとクラスターマネージャーIPを取得
REGION=$(ec2-metadata --availability-zone | cut -d' ' -f2 | sed 's/.$//')
CLUSTER_MANAGER_IP="10.0.3.143"  # 実際のIPに更新

# 管理者パスワードを取得
ADMIN_PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id "SplunkAdminPassword*" \
  --query 'SecretString' --output text \
  --region $REGION | jq -r '.password')

# クラスターに参加
/opt/splunk/bin/splunk edit cluster-config \
  -mode peer \
  -manager_uri https://$CLUSTER_MANAGER_IP:8089 \
  -replication_port 9100 \
  -secret clustersecret \
  -auth admin:$ADMIN_PASSWORD

# 再起動
/opt/splunk/bin/splunk restart

echo "クラスター参加を試行しました。ステータスを確認:"
echo "/opt/splunk/bin/splunk show cluster-member-info -auth admin:$ADMIN_PASSWORD"
```

## 分散検索のトラブルシューティング

### サーチヘッドに "(no servers)" と表示される

**症状:**
- `/opt/splunk/bin/splunk list search-server` が "(no servers)" を返す
- 検索結果にローカルデータのみ表示
- インデクサーのデータが検索で見えない

**解決方法:**

1. **UserDataログで分散検索スクリプトの実行を確認**
   ```bash
   # 分散検索設定を確認
   sudo grep -A 50 "Configure distributed search" /var/log/cloud-init-output.log
   
   # エラーを確認
   sudo grep "integer expression expected" /var/log/cloud-init-output.log
   ```

2. **手動で分散検索を設定**
   ```bash
   # 管理者パスワードを取得
   ADMIN_PASSWORD=$(aws secretsmanager get-secret-value \
     --secret-id <secret-arn> \
     --query 'SecretString' --output text \
     --region us-west-2 | jq -r '.password')
   
   # 各インデクサーをサーチサーバーとして追加
   /opt/splunk/bin/splunk add search-server https://10.0.3.234:8089 \
     -auth admin:$ADMIN_PASSWORD \
     -remoteUsername admin -remotePassword $ADMIN_PASSWORD
   
   /opt/splunk/bin/splunk add search-server https://10.0.4.183:8089 \
     -auth admin:$ADMIN_PASSWORD \
     -remoteUsername admin -remotePassword $ADMIN_PASSWORD
   
   /opt/splunk/bin/splunk add search-server https://10.0.5.253:8089 \
     -auth admin:$ADMIN_PASSWORD \
     -remoteUsername admin -remotePassword $ADMIN_PASSWORD
   ```

3. **設定を確認**
   ```bash
   # 設定されたサーチサーバーをリスト
   /opt/splunk/bin/splunk list search-server -auth admin:$ADMIN_PASSWORD
   
   # 分散検索をテスト
   /opt/splunk/bin/splunk search "index=_internal | stats count by splunk_server" \
     -auth admin:$ADMIN_PASSWORD
   ```

### 既知の問題: grep -c の複数行出力

**最新バージョンで修正済み**: UserDataスクリプトは `head -1 | tr -d '\n'` を使用してgrep -c出力の複数行問題を適切に処理するようになりました。

## サポートへのエスカレーション時期

以下の場合はエスカレーション:
- 永続的なデータ損失警告
- クラスターメンバーが10分以上 "GracefulShutdown" 状態
- クラスター参加確認後もサーチヘッドが検索できない
- splunkd.logに繰り返し自動再起動が記録される

## 有用なログの場所

- **UserData実行**: `/var/log/cloud-init-output.log`
- **Splunkデーモン**: `/opt/splunk/var/log/splunk/splunkd.log`
- **クラスター操作**: `/opt/splunk/var/log/splunk/splunkd.log` ("CMPeer"でgrep)
- **検索の問題**: `/opt/splunk/var/log/splunk/metrics.log`
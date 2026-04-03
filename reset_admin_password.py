"""
reset_admin_password.py

Run this from your terminal if you (the admin) forget your password.
This directly updates DynamoDB — no login needed.

Usage:
  python3 reset_admin_password.py
  python3 reset_admin_password.py --username john.smith --password NewPass@123
"""

import boto3
import hashlib
import hmac
import argparse
from datetime import datetime, timezone

# ── Must match your Lambda environment variable ───────────────
PASSWORD_SECRET = 'rollmonitor-secret-change-me'  # ← change if you changed it
REGION          = 'ap-south-1'

def hash_password(password):
    return hmac.new(
        PASSWORD_SECRET.encode(),
        password.encode(),
        hashlib.sha256
    ).hexdigest()

def reset_password(username, new_password):
    dynamodb    = boto3.resource('dynamodb', region_name=REGION)
    users_table = dynamodb.Table('UsersTable')

    # Find user by username
    res   = users_table.scan(
        FilterExpression=boto3.dynamodb.conditions.Attr('username').eq(username)
    )
    items = res.get('Items', [])

    if not items:
        print(f'❌ User "{username}" not found in UsersTable.')
        return False

    user = items[0]
    users_table.update_item(
        Key={'userId': user['userId']},
        UpdateExpression='SET passwordHash = :h, mustChangePassword = :t, updatedAt = :u',
        ExpressionAttributeValues={
            ':h': hash_password(new_password),
            ':t': True,
            ':u': datetime.now(timezone.utc).isoformat(),
        }
    )
    print(f'✓ Password reset for user "{username}"')
    print(f'  New password: {new_password}')
    print(f'  Role: {user.get("role")}')
    print(f'  They will be asked to change password on next login.')
    return True

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Reset a RollMonitor user password')
    parser.add_argument('--username', default='admin',            help='Username to reset (default: admin)')
    parser.add_argument('--password', default='TempPass@2024!',   help='New temporary password')
    args = parser.parse_args()

    print(f'\n=== RollMonitor Password Reset ===')
    print(f'Username: {args.username}')
    print(f'New password: {args.password}\n')

    confirm = input('Proceed? (yes/no): ').strip().lower()
    if confirm != 'yes':
        print('Cancelled.')
    else:
        reset_password(args.username, args.password)

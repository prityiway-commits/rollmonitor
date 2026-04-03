"""
setup_auth.py
Run this ONCE locally to:
1. Create the 3 new DynamoDB tables
2. Create the first admin user
3. Create a new API Gateway route for the auth Lambda

Run with:  python3 setup_auth.py
Requires:  pip install boto3
           AWS CLI configured (aws configure)
"""

import boto3
import hashlib
import hmac
import secrets
import json
from datetime import datetime, timezone

# ── CONFIG — change these ─────────────────────────────────────
REGION          = 'ap-south-1'
ADMIN_USERNAME  = 'admin'
ADMIN_PASSWORD  = 'RollMonitor@2024!'  # Change after first login
ADMIN_NAME      = 'System Administrator'
PASSWORD_SECRET = 'rollmonitor-secret-change-me'  # Must match lambda_auth.py env var

dynamodb = boto3.resource('dynamodb', region_name=REGION)
client   = boto3.client('dynamodb',  region_name=REGION)

def table_exists(name):
    try:
        client.describe_table(TableName=name)
        return True
    except client.exceptions.ResourceNotFoundException:
        return False

def create_table(name, pk, sk=None):
    if table_exists(name):
        print(f'  ✓ {name} already exists')
        return dynamodb.Table(name)

    attrs = [{'AttributeName': pk, 'AttributeType': 'S'}]
    keys  = [{'AttributeName': pk, 'KeyType': 'HASH'}]
    if sk:
        attrs.append({'AttributeName': sk, 'AttributeType': 'S'})
        keys.append({'AttributeName': sk, 'KeyType': 'RANGE'})

    client.create_table(
        TableName=name,
        AttributeDefinitions=attrs,
        KeySchema=keys,
        BillingMode='PAY_PER_REQUEST',
    )
    waiter = client.get_waiter('table_exists')
    waiter.wait(TableName=name)
    print(f'  ✓ Created {name}')
    return dynamodb.Table(name)

def hash_password(password):
    return hmac.new(PASSWORD_SECRET.encode(), password.encode(), hashlib.sha256).hexdigest()

print('\n=== RollMonitor Auth Setup ===\n')

# 1. Create tables
print('Creating DynamoDB tables...')
users_table    = create_table('UsersTable',    'userId')
org_table      = create_table('OrgTable',      'customerId', 'entityId')
sessions_table = create_table('SessionsTable', 'sessionToken')

# 2. Create admin user
print('\nCreating admin user...')
existing = users_table.scan(
    FilterExpression=boto3.dynamodb.conditions.Attr('username').eq(ADMIN_USERNAME)
).get('Items', [])

if existing:
    print(f'  ✓ Admin user "{ADMIN_USERNAME}" already exists')
else:
    user_id = 'user_' + secrets.token_hex(8)
    users_table.put_item(Item={
        'userId':             user_id,
        'username':           ADMIN_USERNAME,
        'passwordHash':       hash_password(ADMIN_PASSWORD),
        'name':               ADMIN_NAME,
        'role':               'admin',
        'customerId':         None,
        'regionId':           None,
        'plantId':            None,
        'sysids':             [],
        'active':             True,
        'mustChangePassword': True,
        'createdAt':          datetime.now(timezone.utc).isoformat(),
        'createdBy':          'setup_script',
    })
    print(f'  ✓ Admin user created: username="{ADMIN_USERNAME}" password="{ADMIN_PASSWORD}"')
    print(f'  ⚠ Change the password after first login!')

print('\n=== Setup complete! ===')
print("""
Next steps:
1. Deploy lambda_auth.py to a new Lambda function named "RollMonitorAuth"
2. Set environment variable PASSWORD_SECRET in that Lambda
   (same value as in this script)
3. Give the Lambda DynamoDB permissions for:
   UsersTable, OrgTable, SessionsTable (read + write)
4. Create a new API Gateway route:
   POST /auth → RollMonitorAuth Lambda
5. Enable CORS on /auth route
6. Update src/context/AuthContext.jsx:
   const AUTH_URL = 'https://YOUR_NEW_API_GW_URL/auth'
7. Login at http://localhost:5173/login with:
   Username: admin
   Password: RollMonitor@2024!
8. You will be prompted to change password immediately
9. Then go to Admin Panel to create your first customer, region, plant and users
""")

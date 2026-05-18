# OTP SMS Integration Guide - Nimbus IT

## Overview
The PharmaBag API now integrates with **Nimbus IT SMS API** for sending OTP (One-Time Password) messages to users during authentication.

## Environment Variables

Add the following environment variables to your `.env` file or deployment configuration:

```bash
# Nimbus IT SMS API Configuration
NIMBUS_API_URL=http://nimbusit.info/api/pushsmsjson.php
NIMBUS_USER=t5jaipharma
NIMBUS_KEY=010Qftn20u6Y7M31aWNY
NIMBUS_SENDER=PHABAG
NIMBUS_REFERENCE_ID=1564879
NIMBUS_ENTITY_ID=1701163558888608648
NIMBUS_TEMPLATE_ID=1707163835062147514
NIMBUS_OTP_MESSAGE=Welcome to Pharmabag. Use OTP {otp} to login to your Pharmabag account
```

## Configuration Details

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NIMBUS_API_URL` | Yes | `http://nimbusit.info/api/pushsmsjson.php` | Nimbus IT API endpoint |
| `NIMBUS_USER` | Yes | `t5jaipharma` | Nimbus IT account username |
| `NIMBUS_KEY` | Yes | `010Qftn20u6Y7M31aWNY` | Nimbus IT API key |
| `NIMBUS_SENDER` | No | `PHABAG` | SMS sender ID (brand name) |
| `NIMBUS_REFERENCE_ID` | No | `1564879` | Reference ID for API calls |
| `NIMBUS_ENTITY_ID` | No | `1701163558888608648` | Entity ID for compliance |
| `NIMBUS_TEMPLATE_ID` | No | `1707163835062147514` | SMS template ID |
| `NIMBUS_OTP_MESSAGE` | No | `Welcome to Pharmabag...` | OTP message template (use `{otp}` placeholder) |

## API Request Format

The service automatically formats requests according to Nimbus IT specifications:

```json
{
  "Authorization": {
    "User": "t5jaipharma",
    "Key": "010Qftn20u6Y7M31aWNY"
  },
  "Data": {
    "Sender": "PHABAG",
    "Message": "Welcome to Pharmabag. Use OTP 123456 to login to your Pharmabag account",
    "Flash": "0",
    "ReferenceId": "1564879",
    "EntityId": "1701163558888608648",
    "TemplateId": "1707163835062147514",
    "Mobile": ["9831864222"]
  }
}
```

## Development vs Production

### Development Mode
- If `NIMBUS_USER` or `NIMBUS_KEY` are not configured, the OTP is logged to console
- Useful for local development and testing
- No actual SMS messages are sent

### Production Mode
- Requires valid Nimbus IT credentials in environment variables
- OTP messages are sent to user's phone via Nimbus IT API
- If SMS sending fails, the request doesn't fail (OTP is still stored in Redis)

## Error Handling

The service handles the following scenarios:

1. **Invalid Phone Number**: Returns 400 Bad Request
2. **API Unreachable**: Returns 503 Service Unavailable
3. **Invalid Response**: Returns 503 Service Unavailable with descriptive error
4. **Request Timeout**: Returns 503 Service Unavailable (10-second timeout)

## Testing the Integration

### 1. Send OTP Request
```bash
curl -X POST http://localhost:3000/api/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "9831864222"}'
```

### 2. Check OTP in Development
```bash
# Using Redis CLI
redis-cli GET otp:9831864222
```

### 3. Verify OTP
```bash
curl -X POST http://localhost:3000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "9831864222", "otp": "123456"}'
```

## Security Considerations

1. **Credential Management**: Never commit `.env` file to version control
2. **HTTPS Only**: Always use HTTPS in production for API communication
3. **Rate Limiting**: The service enforces rate limiting (max 3 OTP requests per minute per phone)
4. **OTP Expiration**: OTP expires after 2 minutes in Redis
5. **Timing Attack Protection**: Uses constant-time comparison for OTP verification

## Deployment Instructions

### 1. Render Deployment
Update your `Render.yaml` or deployment config:
```yaml
env:
  NIMBUS_API_URL: http://nimbusit.info/api/pushsmsjson.php
  NIMBUS_USER: t5jaipharma
  NIMBUS_KEY: 010Qftn20u6Y7M31aWNY
  NIMBUS_SENDER: PHABAG
  NIMBUS_REFERENCE_ID: 1564879
  NIMBUS_ENTITY_ID: 1701163558888608648
  NIMBUS_TEMPLATE_ID: 1707163835062147514
```

### 2. Docker Deployment
Add environment variables to your docker-compose or Dockerfile:
```dockerfile
ENV NIMBUS_API_URL=http://nimbusit.info/api/pushsmsjson.php
ENV NIMBUS_USER=t5jaipharma
ENV NIMBUS_KEY=010Qftn20u6Y7M31aWNY
```

### 3. Kubernetes Deployment
Create a ConfigMap or Secret:
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: nimbus-otp-config
type: Opaque
stringData:
  NIMBUS_USER: t5jaipharma
  NIMBUS_KEY: 010Qftn20u6Y7M31aWNY
  NIMBUS_API_URL: http://nimbusit.info/api/pushsmsjson.php
```

## Monitoring and Logging

The OTP SMS service logs the following events:

- **INFO**: Successful OTP sent
- **WARN**: OTP service not configured (development mode)
- **ERROR**: Failed to send OTP with reason
- **DEBUG**: OTP generation and API calls (development)

Monitor these logs to ensure the service is functioning correctly in production.

## Troubleshooting

### OTP not being sent
1. Check if `NIMBUS_USER` and `NIMBUS_KEY` are configured
2. Verify Nimbus IT credentials are correct
3. Check network connectivity to `nimbusit.info`
4. Review error logs for detailed failure reason

### Wrong phone number format
- Ensure phone numbers are 10 digits
- Phone must start with 6-9 (Indian mobile numbers)
- Remove any +91 country code prefix

### Rate limit exceeded
- Wait at least 1 minute before requesting another OTP
- Each user can request max 3 OTPs per minute

## API Response Formats

### Success Response
```json
{
  "status": "success",
  "message": "OTP sent successfully",
  "referenceId": "..."
}
```

### Error Response
```json
{
  "statusCode": 400,
  "message": "Invalid phone number format",
  "error": "Bad Request"
}
```

## Support

For issues with:
- **Nimbus IT API**: Contact Nimbus IT support at their service dashboard
- **PharmaBag Integration**: Check logs and verify environment configuration

## References

- [Auth Flow Documentation](./README.md#auth-flow)
- [Environment Configuration](./README.md#environment-variables)
- Nimbus IT API Dashboard: http://nimbusit.info

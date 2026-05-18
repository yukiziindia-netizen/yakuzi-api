# OTP SMS Integration - Quick Setup Guide

## 🚀 Quick Start (5 minutes)

### Step 1: Add Environment Variables

Copy these variables to your `.env` file:

```bash
# Nimbus IT SMS API
NIMBUS_API_URL=http://nimbusit.info/api/pushsmsjson.php
NIMBUS_USER=t5jaipharma
NIMBUS_KEY=010Qftn20u6Y7M31aWNY
NIMBUS_SENDER=PHABAG
NIMBUS_REFERENCE_ID=1564879
NIMBUS_ENTITY_ID=1701163558888608648
NIMBUS_TEMPLATE_ID=1707163835062147514
NIMBUS_OTP_MESSAGE=Welcome to Pharmabag. Use OTP {otp} to login to your Pharmabag account
```

### Step 2: Build & Run

```bash
# Install dependencies (if needed)
npm install

# Build the project
npm run build

# Run in development
npm run start:dev

# Run in production
npm run start:prod
```

### Step 3: Test OTP Service

#### Test 1: Request OTP
```bash
curl -X POST http://localhost:3000/api/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "9831864222"}'
```

**Expected Response:**
```json
{
  "message": "OTP sent successfully"
}
```

#### Test 2: Check OTP in Development Mode

If `NIMBUS_USER` is not set, OTP is logged to console:
- Check console output for: `[DEV] OTP for 9831864222: 123456`

Or retrieve from Redis:
```bash
redis-cli GET otp:9831864222
```

#### Test 3: Verify OTP
```bash
curl -X POST http://localhost:3000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "9831864222", "otp": "123456"}'
```

**Expected Response:**
```json
{
  "message": "OTP verified successfully",
  "data": {
    "accessToken": "...",
    "refreshToken": "...",
    "user": {
      "id": "...",
      "phone": "9831864222",
      "role": "BUYER",
      "status": "PENDING"
    },
    "isNewUser": true
  }
}
```

---

## 🔧 Configuration Modes

### Development Mode (No SMS Sending)
```bash
# Leave NIMBUS_USER and NIMBUS_KEY empty
# OTP will be logged to console and stored in Redis only
NIMBUS_USER=
NIMBUS_KEY=
```

### Production Mode (SMS Sending Enabled)
```bash
# Set all Nimbus IT credentials
NIMBUS_API_URL=http://nimbusit.info/api/pushsmsjson.php
NIMBUS_USER=t5jaipharma
NIMBUS_KEY=010Qftn20u6Y7M31aWNY
```

---

## 📋 Implementation Checklist

- [x] OTP SMS Service created (`src/modules/auth/services/otp-sms.service.ts`)
- [x] DTOs created (`src/modules/auth/dto/nimbus-otp-request.dto.ts`)
- [x] Auth Module updated to use OTP SMS Service
- [x] Auth Service updated to call OTP SMS Service
- [x] Error handling implemented
- [x] Development mode (fallback to console logging)
- [x] Production mode (Nimbus IT API integration)

## 🐛 Troubleshooting

### Issue: "OTP service not configured"
**Cause**: `NIMBUS_USER` or `NIMBUS_KEY` not set
**Solution**: Set environment variables from Nimbus IT account

### Issue: "Failed to send OTP: timeout"
**Cause**: Network issue or Nimbus IT API is down
**Solution**: 
- Check internet connectivity
- Verify Nimbus IT API is accessible
- Check Nimbus IT status page

### Issue: OTP not received on phone
**Cause**: Wrong phone number or SMS provider issue
**Solution**:
- Verify phone number format (10 digits, 6-9 start)
- Check Nimbus IT dashboard for delivery logs
- Verify SMS balance in Nimbus IT account

### Issue: "Invalid phone number format"
**Cause**: Phone number validation failed
**Solution**:
- Use 10-digit Indian phone number
- Start with 6-9 (e.g., 9831864222)
- Don't include +91 or 0 prefix

---

## 📚 Full Documentation

For detailed information, see: [OTP_INTEGRATION_GUIDE.md](./OTP_INTEGRATION_GUIDE.md)

## 🔐 Security Notes

⚠️ **IMPORTANT**: 
- Never commit `.env` file to version control
- Keep Nimbus IT credentials secure
- Rotate API keys regularly
- Monitor logs for suspicious activity
- Use HTTPS in production

## 📞 Support

### For Nimbus IT API Issues
- Contact: Nimbus IT support
- Dashboard: http://nimbusit.info
- Check API documentation for response codes

### For PharmaBag Integration Issues
- Check logs: `tail -f logs/production.log`
- Verify environment variables
- Ensure Redis is running
- Check network connectivity

---

## 🎯 Next Steps

1. **Set environment variables** in your `.env` file
2. **Build and run** the application
3. **Test OTP flow** using the curl commands above
4. **Monitor logs** for any issues
5. **Deploy to production** when ready

Once everything is working, users will receive actual SMS messages with OTP codes when logging in! 🎉

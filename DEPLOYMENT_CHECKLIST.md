# OTP SMS Integration - Deployment Checklist

## Pre-Deployment Verification ✅

### 1. Code Integration
- [x] `OtpSmsService` created at `src/modules/auth/services/otp-sms.service.ts`
- [x] Nimbus IT DTOs created at `src/modules/auth/dto/nimbus-otp-request.dto.ts`
- [x] `AuthModule` updated to provide `OtpSmsService`
- [x] `AuthService` updated to inject and use `OtpSmsService`
- [x] Error handling implemented
- [x] No TypeScript compilation errors

### 2. Configuration Files Created
- [x] `OTP_INTEGRATION_GUIDE.md` - Complete integration documentation
- [x] `OTP_SETUP_QUICKSTART.md` - 5-minute quick start guide
- [x] `OTP_INTEGRATION_SUMMARY.md` - Implementation summary
- [x] `.env.example.otp` - Environment variable template
- [x] `VERIFY_OTP_INTEGRATION.sh` - Verification script

### 3. Environment Setup Checklist

#### Required Variables
```bash
NIMBUS_API_URL=http://nimbusit.info/api/pushsmsjson.php
NIMBUS_USER=t5jaipharma
NIMBUS_KEY=010Qftn20u6Y7M31aWNY
```

#### Optional Variables
```bash
NIMBUS_SENDER=PHABAG
NIMBUS_REFERENCE_ID=1564879
NIMBUS_ENTITY_ID=1701163558888608648
NIMBUS_TEMPLATE_ID=1707163835062147514
NIMBUS_OTP_MESSAGE=Welcome to Pharmabag. Use OTP {otp} to login to your Pharmabag account
```

---

## Pre-Production Deployment Steps

### Step 1: Local Testing
```bash
# Build the project
npm run build

# Run in development mode
npm run start:dev

# Test OTP endpoint
curl -X POST http://localhost:3000/api/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "9831864222"}'

# Check console for OTP (should show in logs if NIMBUS_USER is empty)
# OR check Redis
redis-cli GET otp:9831864222
```

### Step 2: Staging Deployment

#### 2.1 Update Environment Variables
Add to staging `.env`:
```bash
NIMBUS_API_URL=http://nimbusit.info/api/pushsmsjson.php
NIMBUS_USER=t5jaipharma
NIMBUS_KEY=010Qftn20u6Y7M31aWNY
NIMBUS_SENDER=PHABAG
```

#### 2.2 Build and Deploy
```bash
npm install
npm run build
npm run start:prod
```

#### 2.3 Verify in Staging
```bash
# Send OTP
curl -X POST https://staging.pharmabag.com/api/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "9831864222"}'

# Check Nimbus IT dashboard for SMS logs
# Verify SMS was received (if using test phone)
```

### Step 3: Production Deployment

#### 3.1 Final Environment Setup
Ensure these are set in production:
```bash
NIMBUS_API_URL=http://nimbusit.info/api/pushsmsjson.php
NIMBUS_USER=t5jaipharma
NIMBUS_KEY=010Qftn20u6Y7M31aWNY
NIMBUS_SENDER=PHABAG
NIMBUS_REFERENCE_ID=1564879
NIMBUS_ENTITY_ID=1701163558888608648
NIMBUS_TEMPLATE_ID=1707163835062147514
NIMBUS_OTP_MESSAGE=Welcome to Pharmabag. Use OTP {otp} to login to your Pharmabag account
```

#### 3.2 Security Checks
- [ ] `.env` file NOT committed to git
- [ ] `.env` in `.gitignore`
- [ ] Credentials NOT in source code
- [ ] HTTPS enabled in production
- [ ] Rate limiting enabled
- [ ] Logging configured
- [ ] Error monitoring set up

#### 3.3 Deploy to Production
```bash
# On your deployment platform (Render, AWS, etc.)
npm install
npx prisma generate
npm run build
npm run start:prod
```

---

## Post-Deployment Verification

### 1. Health Checks
```bash
# Health endpoint
curl https://api.pharmabag.com/api/health

# Should respond with status and timestamp
```

### 2. OTP Service Verification
```bash
# Test 1: Send OTP
curl -X POST https://api.pharmabag.com/api/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "9831864222"}'

# Expected: {"message": "OTP sent successfully"}

# Test 2: Verify with OTP (check logs or Redis for actual OTP)
curl -X POST https://api.pharmabag.com/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "9831864222", "otp": "123456"}'

# Expected: JWT tokens in response
```

### 3. Monitor Key Metrics
- [ ] OTP send success rate > 95%
- [ ] OTP delivery latency < 5s
- [ ] Zero rate limit violations in first hour
- [ ] No errors in application logs
- [ ] Nimbus IT dashboard shows SMS delivery

### 4. User-Facing Testing
- [ ] Request OTP with valid phone
- [ ] Receive SMS on phone ✓
- [ ] Enter OTP and login
- [ ] Get JWT tokens
- [ ] Access protected endpoints

---

## Rollback Plan (If Needed)

### If OTP Service Fails
1. **Immediate**: Disable SMS sending, fall back to console logging
   ```bash
   # In .env, set:
   NIMBUS_USER=
   NIMBUS_KEY=
   ```

2. **Verify OTP in Redis**: `redis-cli GET otp:9831864222`

3. **Contact Nimbus IT**: Check API status and credentials

4. **Rollback Deployment** (if code issue):
   ```bash
   git revert <commit-hash>
   npm run build
   npm run start:prod
   ```

---

## Monitoring & Alerting

### Key Logs to Monitor
```bash
# Successful OTP send
"OTP sent successfully to 9831864222. Response: {...}"

# Failed OTP send
"Error sending OTP: Failed to connect to Nimbus IT API"

# Development mode
"[DEV] OTP for 9831864222: 123456"

# Rate limit exceeded
"OTP rate limit exceeded for phone"

# Service not configured
"Nimbus IT SMS credentials not fully configured"
```

### Alert Conditions
- [ ] OTP send success rate < 90%
- [ ] API response time > 10s
- [ ] 5+ consecutive failures
- [ ] Nimbus IT API unreachable
- [ ] Rate limit violations

---

## Maintenance Tasks

### Weekly
- [ ] Check Nimbus IT dashboard SMS logs
- [ ] Review OTP error rates
- [ ] Monitor API latency

### Monthly
- [ ] Review and rotate Nimbus IT API key if needed
- [ ] Check SMS delivery reports
- [ ] Verify backup/fallback mechanisms

### Quarterly
- [ ] Review security credentials
- [ ] Update documentation if needed
- [ ] Performance optimization review

---

## Troubleshooting Guide

| Issue | Cause | Solution |
|-------|-------|----------|
| "OTP service not configured" | NIMBUS_USER/KEY not set | Set environment variables |
| SMS not received | Phone format wrong | Use 10-digit Indian number |
| Timeout errors | Network/API down | Check Nimbus IT status |
| Rate limit exceeded | Too many requests | Wait 1 minute |
| "Invalid response" | API returns wrong format | Check Nimbus IT API docs |

See **OTP_INTEGRATION_GUIDE.md** for detailed troubleshooting.

---

## Support Contacts

- **Nimbus IT Support**: http://nimbusit.info
- **PharmaBag DevOps**: [Your contact info]
- **On-Call**: [Your on-call schedule]

---

## Sign-off

- [ ] Development testing completed
- [ ] Staging testing completed
- [ ] Security review passed
- [ ] Performance testing passed
- [ ] Documentation complete
- [ ] Team trained
- [ ] Ready for production

**Date Deployed**: _______________
**Deployed By**: _______________
**Verified By**: _______________

---

**Last Updated**: March 27, 2026
**Integration Status**: ✅ Ready for Production
**Version**: 1.0.0

#!/bin/bash

# OTP Integration Verification Script
# Run this to verify the OTP SMS integration is correctly set up

echo "═══════════════════════════════════════════════════════════════════"
echo "PharmaBag API - OTP SMS Integration Verification"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi
echo "✅ Node.js found: $(node -v)"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi
echo "✅ npm found: $(npm -v)"

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found. Creating from .env.example..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "✅ .env created from .env.example"
    else
        echo "⚠️  .env.example not found. You'll need to create .env manually."
    fi
fi

# Check Node.js modules
echo ""
echo "Checking Node.js modules..."

if grep -q "@nestjs/common" package.json; then
    echo "✅ @nestjs/common found"
else
    echo "❌ @nestjs/common not found"
    exit 1
fi

if grep -q "ioredis" package.json; then
    echo "✅ ioredis found"
else
    echo "❌ ioredis not found"
    exit 1
fi

# Check OTP Service Files
echo ""
echo "Checking OTP Service files..."

if [ -f "src/modules/auth/services/otp-sms.service.ts" ]; then
    echo "✅ OtpSmsService found"
else
    echo "❌ OtpSmsService not found"
    exit 1
fi

if [ -f "src/modules/auth/dto/nimbus-otp-request.dto.ts" ]; then
    echo "✅ Nimbus OTP DTOs found"
else
    echo "❌ Nimbus OTP DTOs not found"
    exit 1
fi

# Check Auth Module
echo ""
echo "Checking Auth Module..."

if grep -q "OtpSmsService" src/modules/auth/auth.module.ts; then
    echo "✅ OtpSmsService registered in AuthModule"
else
    echo "❌ OtpSmsService not registered in AuthModule"
    exit 1
fi

if grep -q "OtpSmsService" src/modules/auth/auth.service.ts; then
    echo "✅ OtpSmsService imported in AuthService"
else
    echo "❌ OtpSmsService not imported in AuthService"
    exit 1
fi

# Check Environment Variables
echo ""
echo "Checking Environment Variables..."

if grep -q "NIMBUS_API_URL" .env 2>/dev/null; then
    echo "✅ NIMBUS_API_URL configured"
else
    echo "⚠️  NIMBUS_API_URL not configured"
fi

if grep -q "NIMBUS_USER" .env 2>/dev/null; then
    user_value=$(grep "^NIMBUS_USER=" .env | cut -d'=' -f2)
    if [ -z "$user_value" ]; then
        echo "⚠️  NIMBUS_USER is empty (development mode)"
    else
        echo "✅ NIMBUS_USER configured"
    fi
else
    echo "⚠️  NIMBUS_USER not configured"
fi

if grep -q "NIMBUS_KEY" .env 2>/dev/null; then
    key_value=$(grep "^NIMBUS_KEY=" .env | cut -d'=' -f2)
    if [ -z "$key_value" ]; then
        echo "⚠️  NIMBUS_KEY is empty (development mode)"
    else
        echo "✅ NIMBUS_KEY configured"
    fi
else
    echo "⚠️  NIMBUS_KEY not configured"
fi

# Check Documentation
echo ""
echo "Checking Documentation..."

if [ -f "OTP_INTEGRATION_GUIDE.md" ]; then
    echo "✅ OTP_INTEGRATION_GUIDE.md found"
else
    echo "⚠️  OTP_INTEGRATION_GUIDE.md not found"
fi

if [ -f "OTP_SETUP_QUICKSTART.md" ]; then
    echo "✅ OTP_SETUP_QUICKSTART.md found"
else
    echo "⚠️  OTP_SETUP_QUICKSTART.md not found"
fi

if [ -f ".env.example.otp" ]; then
    echo "✅ .env.example.otp found"
else
    echo "⚠️  .env.example.otp not found"
fi

# Summary
echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "✅ OTP SMS Integration Verification Complete!"
echo "═══════════════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "1. Ensure all environment variables are set in .env"
echo "2. Run: npm run build"
echo "3. Run: npm run start:dev (for development)"
echo "4. Test OTP: curl -X POST http://localhost:3000/api/auth/send-otp -H 'Content-Type: application/json' -d '{\"phone\": \"9831864222\"}'"
echo ""
echo "For detailed setup, see: OTP_SETUP_QUICKSTART.md"
echo ""

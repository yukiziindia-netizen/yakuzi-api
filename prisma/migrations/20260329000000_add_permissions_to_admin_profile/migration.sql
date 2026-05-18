-- Add permissions column to admin_profiles table
ALTER TABLE "admin_profiles" ADD COLUMN "permissions" TEXT NOT NULL DEFAULT '';

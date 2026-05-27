ALTER TABLE "SocialAccount" ADD COLUMN "loginEncrypted" BYTEA;
ALTER TABLE "SocialAccount" ADD COLUMN "loginIv" BYTEA;
ALTER TABLE "SocialAccount" ADD COLUMN "loginAuthTag" BYTEA;
ALTER TABLE "SocialAccount" ADD COLUMN "passwordEncrypted" BYTEA;
ALTER TABLE "SocialAccount" ADD COLUMN "passwordIv" BYTEA;
ALTER TABLE "SocialAccount" ADD COLUMN "passwordAuthTag" BYTEA;

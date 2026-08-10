-- CreateEnum
CREATE TYPE "ComponentType" AS ENUM ('SKILL', 'PLUGIN', 'AGENT', 'MCP_GATEWAY');

-- CreateEnum
CREATE TYPE "ComponentStatus" AS ENUM ('PUBLISHED', 'DEPRECATED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "DownloadKind" AS ENUM ('COMPONENT', 'TEMPLATE');

-- CreateTable
CREATE TABLE "Component" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "type" "ComponentType" NOT NULL,
    "summary" VARCHAR(300) NOT NULL,
    "readme" TEXT,
    "status" "ComponentStatus" NOT NULL DEFAULT 'PUBLISHED',
    "license" TEXT NOT NULL DEFAULT 'MIT',
    "homepage" TEXT,
    "repository" TEXT,
    "ownerId" TEXT NOT NULL,
    "latestVersionId" TEXT,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "searchVector" tsvector,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComponentVersion" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "changelog" TEXT,
    "publishedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComponentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComponentTag" (
    "componentId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "ComponentTag_pkey" PRIMARY KEY ("componentId","tagId")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "type" "ComponentType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "docsUrl" TEXT,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Download" (
    "id" TEXT NOT NULL,
    "kind" "DownloadKind" NOT NULL,
    "componentId" TEXT,
    "versionId" TEXT,
    "templateId" TEXT,
    "userId" TEXT,
    "ipHash" VARCHAR(64),
    "userAgent" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Download_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Component_slug_key" ON "Component"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Component_latestVersionId_key" ON "Component"("latestVersionId");

-- CreateIndex
CREATE INDEX "Component_type_status_deletedAt_idx" ON "Component"("type", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "Component_ownerId_idx" ON "Component"("ownerId");

-- CreateIndex
CREATE INDEX "Component_downloadCount_idx" ON "Component"("downloadCount" DESC);

-- CreateIndex
CREATE INDEX "Component_createdAt_idx" ON "Component"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ComponentVersion_objectKey_key" ON "ComponentVersion"("objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "ComponentVersion_checksumSha256_key" ON "ComponentVersion"("checksumSha256");

-- CreateIndex
CREATE INDEX "ComponentVersion_componentId_createdAt_idx" ON "ComponentVersion"("componentId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ComponentVersion_componentId_version_key" ON "ComponentVersion"("componentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE INDEX "ComponentTag_tagId_idx" ON "ComponentTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "Template_type_key" ON "Template"("type");

-- CreateIndex
CREATE INDEX "Download_componentId_createdAt_idx" ON "Download"("componentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Download_templateId_createdAt_idx" ON "Download"("templateId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Download_userId_createdAt_idx" ON "Download"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Component" ADD CONSTRAINT "Component_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Component" ADD CONSTRAINT "Component_latestVersionId_fkey" FOREIGN KEY ("latestVersionId") REFERENCES "ComponentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponentVersion" ADD CONSTRAINT "ComponentVersion_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponentVersion" ADD CONSTRAINT "ComponentVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponentTag" ADD CONSTRAINT "ComponentTag_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponentTag" ADD CONSTRAINT "ComponentTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Download" ADD CONSTRAINT "Download_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Download" ADD CONSTRAINT "Download_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ComponentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Download" ADD CONSTRAINT "Download_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Download" ADD CONSTRAINT "Download_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

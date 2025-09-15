# SecureGallery Pro

## Overview

SecureGallery Pro is a comprehensive media management platform designed for secure storage, organization, and sharing of digital assets. The application features enterprise-grade security with AES-256 encryption, a secure vault system for sensitive content, and intelligent categorization capabilities. Built with modern web technologies, it provides a responsive user interface with advanced media viewing capabilities including lightbox functionality, keyboard navigation, and comprehensive import/export features.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript for type safety and modern component patterns
- **Routing**: Wouter for lightweight client-side routing with authentication-based route protection
- **State Management**: TanStack Query (React Query) for server state management and caching
- **UI Framework**: Shadcn/ui components built on Radix UI primitives with Tailwind CSS for styling
- **Build Tool**: Vite for fast development and optimized production builds

### Backend Architecture
- **Runtime**: Node.js with Express.js framework for RESTful API endpoints
- **Language**: TypeScript for full-stack type safety
- **Database ORM**: Drizzle ORM for type-safe database operations and migrations
- **File Processing**: Sharp for image processing and thumbnail generation
- **Authentication**: Replit Auth with OpenID Connect for secure user authentication

### Database Design
- **Primary Database**: PostgreSQL with connection pooling via Neon Database serverless
- **Schema Management**: Drizzle Kit for database migrations and schema evolution
- **Tables**: Users, categories, media files, import batches, activity logs, and sessions
- **Relationships**: Hierarchical categories, user-owned media files, and audit trails

### Security Architecture
- **Encryption**: AES-256-GCM for vault content with PBKDF2 key derivation
- **Session Management**: Express sessions with PostgreSQL store for persistence
- **Authentication Flow**: OAuth2/OpenID Connect with JWT tokens
- **File Security**: SHA-256 hashing for duplicate detection and content verification
- **Access Control**: Role-based permissions with vault passphrase protection

### Media Processing Pipeline
- **Upload Handling**: Multer with memory storage for file processing
- **Image Processing**: Sharp for thumbnail generation and format optimization
- **Video Support**: Metadata extraction and thumbnail generation for video files
- **Duplicate Detection**: SHA-256 hash comparison for efficient duplicate prevention
- **Storage**: Binary content storage in database with optional encryption

### API Architecture
- **RESTful Design**: Standard HTTP methods with consistent response formats
- **Middleware Stack**: Authentication, logging, error handling, and CORS support
- **File Upload**: Multipart form handling with size limits and type validation
- **Pagination**: Offset-based pagination for large media collections
- **Search**: Text-based search across filenames and metadata

## External Dependencies

### Core Framework Dependencies
- **@neondatabase/serverless**: PostgreSQL database connection and pooling
- **drizzle-orm**: Type-safe database ORM with schema management
- **express**: Web application framework for API endpoints
- **sharp**: High-performance image processing library
- **multer**: Middleware for handling multipart form data uploads

### Authentication & Security
- **passport**: Authentication middleware for Express
- **openid-client**: OpenID Connect client for Replit Auth integration
- **connect-pg-simple**: PostgreSQL session store for Express sessions
- **crypto**: Node.js built-in cryptography module for encryption operations

### Frontend UI Libraries
- **@radix-ui/***: Accessible component primitives for complex UI elements
- **@tanstack/react-query**: Server state management and caching
- **tailwindcss**: Utility-first CSS framework for styling
- **react-hook-form**: Form handling with validation
- **wouter**: Lightweight routing library for React

### Development & Build Tools
- **vite**: Fast build tool and development server
- **typescript**: Static type checking for JavaScript
- **@replit/vite-plugin-***: Replit-specific development plugins
- **drizzle-kit**: Database migration and schema management tool

### Utility Libraries
- **date-fns**: Date manipulation and formatting
- **clsx**: Conditional className utility
- **zod**: Runtime type validation and schema definition
- **nanoid**: URL-safe unique ID generation
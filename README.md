
#  Server

A robust Express.js backend application written in TypeScript for managing invoices, customers, business operations, and third-party integrations.

---

## Table of Contents

- [Features](#-features)  
- [Prerequisites](#-prerequisites)  
- [Getting Started](#-getting-started)  
  - [1. Project Installation](#1-project-installation)  
  - [2. Database Setup](#2-database-setup)  
  - [3. Configuration Setup](#3-configuration-setup)  
  - [4. Running the Application](#4-running-the-application)  
  - [5. Test the Server](#5-test-the-server)  
- [Development Environments](#-development-environments)  
- [Troubleshooting](#-troubleshooting)

---

## Features

- Invoice management with detailed line items  
- Customer lifecycle management  
- Service provider handling  
- Payment processing workflows  
- Zoho Books integration  
- AWS S3 integration for document storage  
- OAuth-based authentication and role-based authorization  
- Input validation and error handling  
- Sequelize transaction support

---

## Prerequisites

Make sure you have the following installed on your machine:

- **Node.js** (v16 or higher)  
- **npm**  
- **TypeScript** (install via `npm install -g typescript`)  
- **MySQL Server** (v8.0 or above)  
- **Git**  
- **VS Code** or any preferred IDE  
- **AWS credentials** (obtain from system administrator if needed)

> For AWS integration: Use the export command from the AWS credentials modal (provided by the admin) and paste it into your terminal session if required.

---

## Getting Started

### 1. Project Installation

```bash
git clone 
npm install
```

Check and review the configuration file:

```bash
config/default.json
```

---

### 2. Database Setup

#### a. Install MySQL

**macOS (Homebrew):**
```bash
brew install mysql
brew services start mysql
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install mysql-server
sudo systemctl start mysql
```

#### b. Create Local Database

```sql
mysql -u root -p
CREATE DATABASE ebdb;
CREATE USER 'root'@'localhost' IDENTIFIED BY 'YourPassword';
GRANT ALL PRIVILEGES ON ebdb.* TO 'root'@'localhost';
FLUSH PRIVILEGES;
```

> Ensure the password matches the one set in `config/default.json`.

#### c. Verify Connection

```bash
mysql -u root -p ebdb
```

---

### 3. Configuration Setup

#### 3.1 Insert OAuth Client

```bash
npx ts-node src/scripts/insertOAuthClient.ts
```
You will be prompted to enter:
- **Client ID**  
- **Client Secret**

These can be found in:
```bash
config/test.json
```

```json
"client_id": "<your-client-id>",
"client_secret": "<your-client-secret>"
```

> If not available, contact your team lead or backend admin.

#### 3.2 Insert Admin User

```bash
npx ts-node src/scripts/insertAdminUser.ts
```
Enter:
- **Username**
- **Password**
- **Org ID**

Find `Org ID` using:
```sql
USE ebdb;
SHOW TABLES;
SELECT * FROM Orgs;
```

---

### 4. Running the Application

#### Build the project:
```bash
npm run build
```

#### Start the server:
```bash
npm start
```

#### (Optional) Run in staging mode:
```bash
NODE_ENV=staging RDS_HOSTNAME='your-db-host' RDS_PORT=3306 RDS_DB_NAME=ebdb RDS_USERNAME=ebroot RDS_PASSWORD='your-password' node dist/server.js
```

---

### 5. Test the Server

Open your browser:
```
http://localhost:8080/health
```
You should see:
```
OK
```

---

## Development Environments

- **Local**: Development and debugging
- **Staging**: Integration and QA
- **Production**: Live deployment via CI/CD

---

## Troubleshooting

- **Access Denied (MySQL):**
```sql
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'YourPassword';
FLUSH PRIVILEGES;
```

- **`res.status is not a function`:**
Ensure Express error middleware follows correct signature:
```ts
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  res.status(500).json({ error: 'Internal server error' });
});
```

- **AWS errors:**
Ensure `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are set in your shell if S3 is used.


You should see:
```
OK
```

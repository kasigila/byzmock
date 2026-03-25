/*********************************
 * BYZ WEB APP — MULTI-EVENT APPS SCRIPT
 * Sheet columns (A → Q):
 * A timestamp
 * B bookingId
 * C bookingType
 * D tier
 * E description
 * F quantity
 * G checkedInCount
 * H lastCheckInTime
 * I amount
 * J name
 * K phone
 * L email
 * M transactionCode
 * N status
 * O requestId
 * P rejectionReason (NEW)
 * Q rejectionNotes (NEW)
 *********************************/

/*********************************
 * CONFIG
 *********************************/
const SHEETS = {
  groove: "GROOVE_BOOKINGS",
  tempo:  "TEMPO_BOOKINGS",
  apt:    "APT_REQUESTS",
  contact: "CONTACT_MESSAGES",
  ratings: "RATINGS",
  faqFeedback: "FAQ_FEEDBACK"
};

const BYZ_EMAIL  = "byzinthehoodz@gmail.com";
const WEBAPP_URL = "https://script.google.com/macros/s/AKfycbxl8qg5fxw8yWZJj-R98x0V0nBALjQv66xuJLiom5rkEh_BpYtZRrMcFlYkjxAOq6UC/exec";

// SECURITY: Admin PIN stored in PropertiesService (set via script editor: File > Project Settings > Script Properties)
// Fallback to hardcoded value if not set (for backward compatibility)
function getAdminPin_() {
  const stored = PropertiesService.getScriptProperties().getProperty("ADMIN_PIN");
  return stored || "weballwithbyz"; // Fallback for backward compatibility
}

function AUTH_URLFETCH() {
  UrlFetchApp.fetch("https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=test");
}

/*********************************
 * MAIN HANDLERS
 *********************************/
// Handle OPTIONS preflight requests for CORS
function doOptions(e) {
  // Return empty response with proper MIME type
  // Google Apps Script web app deployment handles CORS headers automatically
  return ContentService
    .createTextOutput("")
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const action = String(body.action || "");

    // ADD BOOKING (Groove/Tempo)
    if (action === "addBooking") {
      const b = body.data || {};
      const eventKey = normalizeEvent_(b.eventKey || "groove");
      const sheet = getSheet_(eventKey);

      const lock = LockService.getScriptLock();
      lock.waitLock(10000);

      try {
        const requestId = norm_(b.requestId) || Utilities.getUuid();
        const txn = norm_(b.transactionCode);

        // DEDUPE: same txn
        const existingByTxn = txn ? findBookingIdByTxn_(sheet, txn) : "";
        if (existingByTxn) {
          return json_({ success: true, bookingId: existingByTxn, deduped: true, eventKey });
        }

        // DEDUPE: same requestId
        const existingByReq = findBookingIdByRequestId_(sheet, requestId);
        if (existingByReq) {
          return json_({ success: true, bookingId: existingByReq, deduped: true, eventKey });
        }

        const bookingId = generateBookingId_(eventKey, b.bookingType);
        const qty = safeNum_(b.quantity, 1);

        const row = [
          new Date().toISOString(),  // A
          bookingId,                 // B
          b.bookingType || "",       // C
          b.tier || "",              // D
          b.description || "",      // E
          qty,                       // F
          0,                         // G
          "",                        // H
          b.amount || "",            // I
          b.name || "",              // J
          b.phone || "",             // K
          b.email || "",             // L
          b.transactionCode || "",   // M
          "PENDING",                 // N
          requestId,                 // O
          "",                        // P (rejectionReason)
          ""                         // Q (rejectionNotes)
        ];

        sheet.appendRow(row);

        let pendingEmailSent = false;
        let pendingEmailError = "";
        try {
          pendingEmailSent = sendPendingEmail_(b.name, b.email, bookingId, b.description, qty, eventLabel_(eventKey));
        } catch (err) {
          pendingEmailSent = false;
          pendingEmailError = "PENDING_EMAIL_FAILED: " + (err && err.message ? err.message : String(err));
        }

        return json_({
          success: true,
          bookingId,
          eventKey,
          pendingEmailSent,
          pendingEmailError
        });

      } finally {
        lock.releaseLock();
      }
    }

    // ADD APT REQUEST
    if (action === "addAptRequest") {
      const r = body.data || {};
      const sheet = getSheet_("apt");

      const lock = LockService.getScriptLock();
      lock.waitLock(10000);

      try {
        const requestId = norm_(r.requestId) || Utilities.getUuid();
        const bookingId = generateBookingId_("apt", "APT");

        const desc = [
          "APT Request",
          r.instagram ? "IG: " + r.instagram : "",
          r.beenBefore ? "Been before: " + r.beenBefore : "",
          r.notes ? "Notes: " + r.notes : ""
        ].filter(Boolean).join(" | ");

        const row = [
          new Date().toISOString(),  // A
          bookingId,                 // B
          "APT",                     // C
          "",                        // D
          desc,                      // E
          1,                         // F
          0,                         // G
          "",                        // H
          "",                        // I
          r.name || "",              // J
          r.phone || "",             // K
          r.email || "",             // L
          "",                        // M
          "PENDING",                 // N
          requestId,                 // O
          "",                        // P (rejectionReason)
          ""                         // Q (rejectionNotes)
        ];

        sheet.appendRow(row);

        return json_({ success: true, bookingId, eventKey: "apt" });

      } finally {
        lock.releaseLock();
      }
    }

    // APPROVE PAYMENT (ADMIN)
    if (action === "approvePayment") {
      const pin = String(body.pin || "");
      if (pin !== getAdminPin_()) return json_({ success: false, error: "Unauthorized (bad pin)" });

      const bookingId = norm_(body.bookingId);
      const eventKey = normalizeEvent_(body.eventKey || "");
      if (!bookingId) return json_({ success: false, error: "Missing bookingId" });

      const resend = !!body.resend;
      const out = approveBooking_(bookingId, resend, eventKey);

      return json_(out);
    }

    // REJECT BOOKING (ADMIN)
    if (action === "rejectBooking") {
      const pin = String(body.pin || "");
      if (pin !== getAdminPin_()) return json_({ success: false, error: "Unauthorized (bad pin)" });

      const bookingId = norm_(body.bookingId);
      const eventKey = normalizeEvent_(body.eventKey || "");
      if (!bookingId) return json_({ success: false, error: "Missing bookingId" });

      // NEW: Accept rejectionReason and rejectionNotes (backward compatible)
      const rejectionReason = norm_(body.rejectionReason || "other");
      const rejectionNotes = norm_(body.rejectionNotes || "");

      const out = rejectBooking_(bookingId, eventKey, rejectionReason, rejectionNotes);
      return json_(out);
    }

    // UNDO REJECTION (ADMIN) - NEW
    if (action === "undoRejection") {
      const pin = String(body.pin || "");
      if (pin !== getAdminPin_()) return json_({ success: false, error: "Unauthorized (bad pin)" });

      const bookingId = norm_(body.bookingId);
      const eventKey = normalizeEvent_(body.eventKey || "");
      if (!bookingId) return json_({ success: false, error: "Missing bookingId" });

      const out = undoRejection_(bookingId, eventKey);
      return json_(out);
    }

    // CHECK-IN (DOOR)
    if (action === "checkin") {
      const pin = String(body.pin || "");
      if (pin !== getAdminPin_()) return json_({ success: false, error: "Unauthorized" });

      const bookingId = norm_(body.bookingId);
      const count = body.count;
      const eventKey = normalizeEvent_(body.eventKey || "");

      if (!bookingId) return json_({ success: false, error: "Missing bookingId" });

      const out = checkIn_(bookingId, count, eventKey);
      return json_(out);
    }

    // GET BOOKING (Single booking by ID)
    // SECURITY: Only returns public booking info, not sensitive data
    if (action === "getBooking") {
      const bookingId = norm_(body.bookingId || "");
      const eventKey = normalizeEvent_(body.eventKey || "groove");

      if (!bookingId) return json_({ success: false, error: "Missing bookingId" });

      const booking = getBooking_(bookingId, eventKey);
      if (booking) {
        // SECURITY: Only return public info, not sensitive data
        // Booking IDs are in QR codes/URLs, so we limit what's exposed
        const safeBooking = {
          bookingId: booking.bookingId,
          eventKey: booking.eventKey,
          bookingType: booking.bookingType,
          tier: booking.tier,
          description: booking.description,
          quantity: booking.quantity,
          checkedInCount: booking.checkedInCount,
          amount: booking.amount,
          status: booking.status,
          timestamp: booking.timestamp,
          // Don't expose: name, phone, email, transactionCode (sensitive)
        };
        return json_({ success: true, booking: safeBooking });
      } else {
        return json_({ success: false, error: "Booking not found" });
      }
    }

    // RESEND BOOKING EMAIL (User-facing - resends confirmation email)
    if (action === "resendBookingEmail") {
      const bookingId = norm_(body.bookingId || "");
      const email = norm_(body.email || "");
      const eventKey = normalizeEvent_(body.eventKey || "groove");

      if (!bookingId) return json_({ success: false, error: "Missing bookingId" });
      if (!email) return json_({ success: false, error: "Email required" });

      // SECURITY: Verify email matches booking
      const booking = getBooking_(bookingId, eventKey);
      if (!booking) {
        return json_({ success: false, error: "Booking not found" });
      }

      // SECURITY: Verify email matches the booking's email
      if (norm_(booking.email).toLowerCase() !== email.toLowerCase()) {
        return json_({ success: false, error: "Email does not match this booking" });
      }

      // SECURITY: Only allow resending for CONFIRMED bookings
      if (norm_(booking.status) !== "CONFIRMED") {
        return json_({ success: false, error: "Can only resend emails for confirmed bookings" });
      }

      // Resend the confirmation email
      try {
        const emailSent = sendConfirmedEmail(
          booking.name || "",
          email,
          bookingId,
          booking.description || "",
          booking.amount || "",
          booking.quantity || 1,
          eventLabel_(eventKey),
          eventKey
        );

        if (emailSent) {
          return json_({ success: true, message: "Email sent successfully" });
        } else {
          return json_({ success: false, error: "Failed to send email" });
        }
      } catch (err) {
        return json_({ success: false, error: "Email send failed: " + (err.message || String(err)) });
      }
    }

    // SEND VERIFICATION CODE (Email verification for booking lookup)
    if (action === "sendVerificationCode") {
      const email = norm_(body.email || "");
      if (!email) return json_({ success: false, error: "Email required" });

      // SECURITY: Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return json_({ success: false, error: "Invalid email format" });
      }

      // SECURITY: Rate limiting - check attempts in last hour
      const rateKey = "rate_" + email.toLowerCase().replace(/[^a-z0-9]/g, "_");
      const rateData = PropertiesService.getScriptProperties().getProperty(rateKey);
      const now = Date.now();
      let attempts = [];
      
      if (rateData) {
        attempts = JSON.parse(rateData).filter(t => (now - t) < 3600000); // Last hour
      }
      
      // Max 5 attempts per hour per email
      if (attempts.length >= 5) {
        return json_({ success: false, error: "Too many requests. Please try again later." });
      }
      
      attempts.push(now);
      PropertiesService.getScriptProperties().setProperty(rateKey, JSON.stringify(attempts));

      // SECURITY: Always return success to prevent email enumeration
      // Only send email if bookings exist, but don't reveal this
      const hasBookings = getBookingsByEmail_(email).length > 0;
      
      if (hasBookings) {
        // Generate 6-digit code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expires = Date.now() + (10 * 60 * 1000); // 10 minutes

        // Store code in PropertiesService (temporary storage)
        const key = "verify_" + email.toLowerCase().replace(/[^a-z0-9]/g, "_");
        PropertiesService.getScriptProperties().setProperty(key, JSON.stringify({
          code: code,
          expires: expires,
          attempts: 0 // Track failed verification attempts
        }));

        // Send email with code
        try {
          MailApp.sendEmail({
            to: email,
            subject: "BYZ Booking Verification Code",
            htmlBody: `
              <div style="font-family:Arial,sans-serif;line-height:1.6;max-width:600px;margin:0 auto">
                <div style="background:#ffffff;padding:32px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.1)">
                  <h2 style="color:#000;margin:0 0 20px 0;font-size:24px;font-weight:700">BYZ Booking Verification</h2>
                  
                  <p style="color:#333;margin:0 0 16px 0;font-size:16px">Hi,</p>
                  
                  <p style="color:#333;margin:0 0 24px 0;font-size:16px">You requested to view your BYZ bookings. Use this verification code:</p>
                  
                  <div style="background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);padding:24px;text-align:center;margin:24px 0;border-radius:12px;box-shadow:0 4px 12px rgba(102,126,234,0.3)">
                    <div style="color:#fff;font-size:36px;font-weight:900;letter-spacing:8px;font-family:monospace">${code}</div>
                  </div>
                  
                  <p style="color:#666;font-size:14px;margin:16px 0 0 0">This code expires in <strong>10 minutes</strong> and can only be used once.</p>
                  
                  <div style="margin-top:32px;padding-top:24px;border-top:1px solid #e5e5e5">
                    <p style="color:#999;font-size:12px;margin:0 0 8px 0">If you didn't request this code, please ignore this email.</p>
                    <p style="color:#999;font-size:12px;margin:0">— BYZ Entertainment</p>
                  </div>
                </div>
              </div>
            `
          });
        } catch (err) {
          // Log error but don't reveal to prevent enumeration
          console.error("Email send failed for:", email, err);
          // Still return success to prevent enumeration, but log for debugging
        }
      }
      
      // Always return success (prevents email enumeration)
      // But provide helpful message for users who might have used different email
      return json_({ 
        success: true, 
        message: "If this email has bookings, a verification code has been sent. Check your inbox (and spam folder). If you don't receive a code within a few minutes, you may have used a different email address for your booking." 
      });
    }

    // GET EMAILS BY PHONE (For phone lookup)
    if (action === "getEmailsByPhone") {
      const phone = norm_(body.phone || "");
      if (!phone) return json_({ success: false, error: "Phone number required" });
      
      // Normalize phone (remove spaces, dashes, etc.)
      const normalizedPhone = phone.replace(/[\s\-\(\)]/g, "");
      
      // Search across all sheets for bookings with this phone
      const emails = new Set();
      for (const eventKey of ["groove", "tempo"]) {
        const sheet = getSheet_(eventKey);
        if (!sheet) continue;
        
        const data = sheet.getDataRange().getValues();
        // Skip header row
        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          const rowPhone = norm_(row[10] || ""); // Column K (0-indexed: 10)
          if (rowPhone && rowPhone.replace(/[\s\-\(\)]/g, "") === normalizedPhone) {
            const email = norm_(row[11] || ""); // Column L (0-indexed: 11)
            if (email) emails.add(email);
          }
        }
      }
      
      return json_({ 
        success: true, 
        emails: Array.from(emails),
        count: emails.size
      });
    }

    // GET BOOKINGS BY EMAIL (Requires verification code)
    if (action === "getBookingsByEmail") {
      const email = norm_(body.email || "");
      const verificationCode = norm_(body.verificationCode || "");
      
      if (!email) return json_({ success: false, error: "Email required" });
      if (!verificationCode) return json_({ success: false, error: "Verification code required" });

      // SECURITY: Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return json_({ success: false, error: "Invalid email format" });
      }

      // Verify code
      const key = "verify_" + email.toLowerCase().replace(/[^a-z0-9]/g, "_");
      const stored = PropertiesService.getScriptProperties().getProperty(key);
      
      if (!stored) {
        return json_({ success: false, error: "No verification code found. Please request a new code." });
      }

      const data = JSON.parse(stored);
      
      // SECURITY: Brute force protection - lock after 5 failed attempts
      if (data.code !== verificationCode) {
        const attempts = (data.attempts || 0) + 1;
        if (attempts >= 5) {
          // Lock the code - delete it and require new code
          PropertiesService.getScriptProperties().deleteProperty(key);
          return json_({ success: false, error: "Too many failed attempts. Please request a new verification code." });
        }
        // Update attempt count
        data.attempts = attempts;
        PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(data));
        return json_({ success: false, error: "Invalid verification code" });
      }

      if (Date.now() > data.expires) {
        PropertiesService.getScriptProperties().deleteProperty(key);
        return json_({ success: false, error: "Verification code expired. Please request a new code." });
      }

      // Code is valid - get bookings and delete code (one-time use)
      PropertiesService.getScriptProperties().deleteProperty(key);
      const bookings = getBookingsByEmail_(email);
      
      // SECURITY: Mask sensitive data in bookings
      const safeBookings = bookings.map(b => ({
        bookingId: b.bookingId,
        eventKey: b.eventKey,
        bookingType: b.bookingType,
        tier: b.tier,
        description: b.description,
        quantity: b.quantity,
        checkedInCount: b.checkedInCount,
        amount: b.amount,
        status: b.status,
        timestamp: b.timestamp,
        // Don't expose: name, phone, email, transactionCode (sensitive)
      }));
      
      return json_({ success: true, bookings: safeBookings });
    }

    // GET CONTACT MESSAGES (Admin only)
    if (action === "getContactMessages") {
      const adminPin = norm_(body.adminPin || "");
      const storedPin = getAdminPin_();
      
      if (adminPin !== storedPin) {
        return json_({ success: false, error: "Unauthorized" });
      }

      try {
        const sheet = getSheet_("contact");
        const data = sheet.getDataRange().getValues();
        
        // Skip header row
        const messages = [];
        for (let i = 1; i < data.length; i++) {
          messages.push({
            timestamp: data[i][0] || "",
            name: data[i][1] || "",
            email: data[i][2] || "",
            phone: data[i][3] || "",
            subject: data[i][4] || "",
            message: data[i][5] || "",
            status: data[i][6] || "NEW",
            rowIndex: i + 1 // For updating status
          });
        }
        
        // Sort by timestamp (newest first)
        messages.sort((a, b) => {
          const dateA = new Date(a.timestamp);
          const dateB = new Date(b.timestamp);
          return dateB - dateA;
        });
        
        return json_({ success: true, messages: messages });
      } catch (err) {
        return json_({ success: false, error: "Failed to fetch contact messages" });
      }
    }

    // UPDATE CONTACT MESSAGE STATUS (Admin only)
    if (action === "updateContactStatus") {
      const adminPin = norm_(body.adminPin || "");
      const storedPin = getAdminPin_();
      
      if (adminPin !== storedPin) {
        return json_({ success: false, error: "Unauthorized" });
      }

      const rowIndex = safeNum_(body.rowIndex, 0);
      const status = norm_(body.status || "READ");
      
      if (rowIndex < 2) { // Row 1 is header
        return json_({ success: false, error: "Invalid row index" });
      }

      try {
        const sheet = getSheet_("contact");
        sheet.getRange(rowIndex, 7).setValue(status); // Column G = status
        return json_({ success: true, message: "Status updated" });
      } catch (err) {
        return json_({ success: false, error: "Failed to update status" });
      }
    }

    // SUBMIT CONTACT FORM
    if (action === "submitContact") {
      const data = body.data || {};
      const name = norm_(data.name || "");
      const email = norm_(data.email || "");
      const phone = norm_(data.phone || "");
      const subject = norm_(data.subject || "");
      const message = norm_(data.message || "");

      // Validation
      if (!name) return json_({ success: false, error: "Name is required" });
      if (!email) return json_({ success: false, error: "Email is required" });
      if (!subject) return json_({ success: false, error: "Subject is required" });
      if (!message) return json_({ success: false, error: "Message is required" });

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return json_({ success: false, error: "Invalid email format" });
      }

      try {
        const sheet = getSheet_("contact");
        
        // Append to contact messages sheet
        // Columns: A=timestamp, B=name, C=email, D=phone, E=subject, F=message, G=status
        const row = [
          new Date().toISOString(),  // A: timestamp
          name,                       // B: name
          email,                      // C: email
          phone,                      // D: phone
          subject,                    // E: subject
          message,                    // F: message
          "NEW"                       // G: status (NEW, READ, REPLIED)
        ];
        
        sheet.appendRow(row);

        // Send notification email to BYZ
        try {
          const subjectLabels = {
            "booking": "Booking Inquiry",
            "support": "Support Request",
            "partnership": "Partnership Opportunity",
            "media": "Media & Press",
            "feedback": "Feedback",
            "other": "Other"
          };
          
          const subjectLabel = subjectLabels[subject] || subject;
          
          MailApp.sendEmail({
            to: BYZ_EMAIL,
            subject: `New Contact Form: ${subjectLabel} - ${name}`,
            htmlBody: `
              <div style="font-family:Arial,sans-serif;line-height:1.6;max-width:600px;margin:0 auto">
                <div style="background:#ffffff;padding:32px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.1)">
                  <h2 style="color:#000;margin:0 0 20px 0;font-size:24px;font-weight:700">New Contact Form Submission</h2>
                  
                  <div style="background:#f5f5f5;padding:20px;border-radius:8px;margin-bottom:20px">
                    <p style="margin:0 0 8px 0;color:#666;font-size:14px"><strong>Subject:</strong> ${esc_(subjectLabel)}</p>
                    <p style="margin:0 0 8px 0;color:#666;font-size:14px"><strong>From:</strong> ${esc_(name)}</p>
                    <p style="margin:0 0 8px 0;color:#666;font-size:14px"><strong>Email:</strong> ${esc_(email)}</p>
                    ${phone ? `<p style="margin:0 0 8px 0;color:#666;font-size:14px"><strong>Phone:</strong> ${esc_(phone)}</p>` : ''}
                    <p style="margin:8px 0 0 0;color:#666;font-size:14px"><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                  </div>
                  
                  <div style="margin:20px 0">
                    <h3 style="color:#000;margin:0 0 12px 0;font-size:18px">Message:</h3>
                    <div style="background:#fafafa;padding:16px;border-left:4px solid #667eea;border-radius:4px">
                      <p style="margin:0;color:#333;font-size:15px;white-space:pre-wrap">${esc_(message)}</p>
                    </div>
                  </div>
                  
                  <div style="margin-top:24px;padding-top:20px;border-top:1px solid #eee">
                    <p style="margin:0;color:#999;font-size:12px">This message was submitted through the BYZ website contact form.</p>
                  </div>
                </div>
              </div>
            `
          });
        } catch (emailErr) {
          // Log error but don't fail the submission
          console.error("Failed to send notification email:", emailErr);
        }

        return json_({ success: true, message: "Your message has been sent successfully. We'll get back to you soon!" });
      } catch (err) {
        return json_({ success: false, error: "Failed to submit message. Please try again or contact us via WhatsApp." });
      }
    }

    // SUBMIT RATING (User feedback)
    if (action === "submitRating") {
      const data = body.data || {};
      const score = data.score || 0;
      const siteScore = data.siteScore || 0;
      const nps = data.nps || 0;
      const tags = data.tags || [];
      const speed = data.speed || 0;
      const clarity = data.clarity || 0;
      const design = data.design || 0;
      const notes = norm_(data.notes || "");
      const email = norm_(data.email || "");
      const name = norm_(data.name || "");

      if (score === 0) {
        return json_({ success: false, error: "Please select a rating" });
      }

      try {
        const sheet = getSheet_("ratings");
        
        // Append to ratings sheet
        // Columns: A=timestamp, B=score, C=siteScore, D=nps, E=tags, F=speed, G=clarity, H=design, I=notes, J=email, K=name
        const row = [
          new Date().toISOString(),  // A: timestamp
          score,                      // B: score (1-5)
          siteScore,                  // C: siteScore (0-10)
          nps,                        // D: nps (0-10)
          tags.join(", "),            // E: tags
          speed,                      // F: speed (0-10)
          clarity,                    // G: clarity (0-10)
          design,                     // H: design (0-10)
          notes,                      // I: notes
          email,                      // J: email (optional)
          name                        // K: name (optional)
        ];
        
        sheet.appendRow(row);

        return json_({ success: true, message: "Thank you for your feedback!" });
      } catch (err) {
        return json_({ success: false, error: "Failed to submit rating. Please try again." });
      }
    }

    // SUBMIT FAQ FEEDBACK
    if (action === "submitFAQFeedback") {
      const question = norm_(body.question || "");
      const helpful = body.helpful === true || body.helpful === "true" || body.helpful === 1;

      if (!question) {
        return json_({ success: false, error: "Question is required" });
      }

      try {
        const sheet = getSheet_("faqFeedback");
        
        // Check if headers exist, if not create them
        if (sheet.getLastRow() === 0) {
          sheet.appendRow(["Timestamp", "Question", "Helpful"]);
        }
        
        // Append to FAQ feedback sheet
        // Columns: A=timestamp, B=question, C=helpful (TRUE/FALSE)
        const row = [
          new Date().toISOString(),  // A: timestamp
          question,                   // B: question text
          helpful                     // C: helpful (TRUE/FALSE)
        ];
        
        sheet.appendRow(row);

        return json_({ success: true, message: "Feedback submitted!" });
      } catch (err) {
        return json_({ success: false, error: "Failed to submit feedback. Please try again." });
      }
    }

    // GET FAQ FEEDBACK (Admin only)
    if (action === "getFAQFeedback") {
      const adminPin = norm_(body.adminPin || "");
      const storedPin = getAdminPin_();
      
      if (adminPin !== storedPin) {
        return json_({ success: false, error: "Unauthorized" });
      }

      try {
        const sheet = getSheet_("faqFeedback");
        const data = sheet.getDataRange().getValues();
        
        // Skip header row
        const feedback = [];
        for (let i = 1; i < data.length; i++) {
          feedback.push({
            timestamp: data[i][0] || "",
            question: data[i][1] || "",
            helpful: data[i][2] === true || data[i][2] === "TRUE" || data[i][2] === 1
          });
        }

        return json_({ success: true, feedback: feedback });
      } catch (err) {
        return json_({ success: false, error: "Failed to load FAQ feedback" });
      }
    }

    return json_({ success: false, error: "Invalid action" });

  } catch (err) {
    return json_({ success: false, error: (err && err.message) ? err.message : String(err) });
  }
}

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const bid = params.bid ? String(params.bid).trim() : "";
  const eventKey = normalizeEvent_(params.event || params.eventKey || "");
  const action = params.action || "";

  // ADMIN ACTIONS VIA GET (to avoid CORS preflight)
  if (action === "getContactMessages") {
    const adminPin = norm_(params.adminPin || "");
    const storedPin = getAdminPin_();
    
    if (adminPin !== storedPin) {
      return json_({ success: false, error: "Unauthorized" });
    }

    try {
      const sheet = getSheet_("contact");
      const data = sheet.getDataRange().getValues();
      
      const messages = [];
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const name = norm_(row[1] || "");
        const email = norm_(row[2] || "");
        const message = norm_(row[5] || "");
        
        // Skip empty rows - must have at least name or email AND a message
        if (!name && !email) continue; // No contact info
        if (!message || message.trim().length < 3) continue; // No meaningful message content
        
        messages.push({
          rowIndex: i + 1,
          timestamp: row[0] || "",
          name: name,
          email: email,
          phone: norm_(row[3] || ""),
          subject: norm_(row[4] || "other"),
          message: message,
          status: norm_(row[6] || "NEW").toUpperCase()
        });
      }
      
      return json_({ success: true, messages: messages });
    } catch (err) {
      return json_({ success: false, error: err.toString() });
    }
  }

  if (action === "getFAQFeedback") {
    const adminPin = norm_(params.adminPin || "");
    const storedPin = getAdminPin_();
    
    if (adminPin !== storedPin) {
      return json_({ success: false, error: "Unauthorized" });
    }

    try {
      const sheet = getSheet_("faqFeedback");
      const data = sheet.getDataRange().getValues();
      
      const feedback = [];
      for (let i = 1; i < data.length; i++) {
        feedback.push({
          timestamp: data[i][0] || "",
          question: data[i][1] || "",
          helpful: data[i][2] === true || data[i][2] === "TRUE" || data[i][2] === 1
        });
      }
      
      return json_({ success: true, feedback: feedback });
    } catch (err) {
      return json_({ success: false, error: err.toString() });
    }
  }

  // VERIFY MODE
  if (bid) {
    const out = verifyBooking_(bid, eventKey);
    return json_(out);
  }

  // LIST MODE
  if (eventKey) {
    const sheet = getSheet_(eventKey);
    return json_({ bookings: listBookings_(sheet, eventKey) });
  }

  // ALL EVENTS
  const all = []
    .concat(listBookings_(getSheet_("groove"), "groove"))
    .concat(listBookings_(getSheet_("tempo"), "tempo"))
    .concat(listBookings_(getSheet_("apt"), "apt"));

  return json_({ bookings: all });
}

/*********************************
 * CORE HELPERS
 *********************************/
function getSheet_(eventKey) {
  const key = normalizeEvent_(eventKey || "groove");
  const name = SHEETS[key] || SHEETS.groove;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error("Sheet not found: " + name);
  return sheet;
}

function getBooking_(bookingId, eventKey) {
  bookingId = norm_(bookingId);
  if (!bookingId) return null;

  const sheet = getSheet_(eventKey);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (norm_(data[i][1]) === bookingId) { // Column B = bookingId
      return {
        bookingId: data[i][1] || "",
        eventKey: eventKey,
        bookingType: data[i][2] || "",
        tier: data[i][3] || "",
        description: data[i][4] || "",
        quantity: safeNum_(data[i][5], 1),
        checkedInCount: safeNum_(data[i][6], 0),
        lastCheckInTime: data[i][7] || "",
        amount: data[i][8] || "",
        name: data[i][9] || "",
        phone: data[i][10] || "",
        email: data[i][11] || "",
        transactionCode: data[i][12] || "",
        status: data[i][13] || "PENDING",
        requestId: data[i][14] || "",
        rejectionReason: data[i][15] || "",
        rejectionNotes: data[i][16] || "",
        timestamp: data[i][0] || ""
      };
    }
  }
  return null;
}

function getBookingsByEmail_(email) {
  email = norm_(email).toLowerCase().trim();
  if (!email) return [];

  const allBookings = [];
  const events = ["groove", "tempo"];

  events.forEach(eventKey => {
    const sheet = getSheet_(eventKey);
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      const rowEmail = norm_(data[i][11] || "").toLowerCase().trim(); // Column L = email
      if (rowEmail === email) {
        allBookings.push({
          bookingId: data[i][1] || "",
          eventKey: eventKey,
          bookingType: data[i][2] || "",
          tier: data[i][3] || "",
          description: data[i][4] || "",
          quantity: safeNum_(data[i][5], 1),
          checkedInCount: safeNum_(data[i][6], 0),
          lastCheckInTime: data[i][7] || "",
          amount: data[i][8] || "",
          name: data[i][9] || "",
          phone: data[i][10] || "",
          email: data[i][11] || "",
          transactionCode: data[i][12] || "",
          status: data[i][13] || "PENDING",
          requestId: data[i][14] || "",
          rejectionReason: data[i][15] || "",
          rejectionNotes: data[i][16] || "",
          timestamp: data[i][0] || ""
        });
      }
    }
  });

  // Sort by timestamp (newest first)
  return allBookings.sort((a, b) => {
    const dateA = new Date(a.timestamp || 0);
    const dateB = new Date(b.timestamp || 0);
    return dateB - dateA;
  });
}

function listBookings_(sheet, eventKey) {
  const rows = sheet.getDataRange().getValues();
  const bookings = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    bookings.push({
      eventKey: eventKey,
      timestamp: r[0] || "",
      bookingId: r[1] || "",
      bookingType: r[2] || "",
      tier: r[3] || "",
      description: r[4] || "",
      quantity: r[5] || "",
      checkedInCount: r[6] || 0,
      lastCheckInTime: r[7] || "",
      amount: r[8] || "",
      name: r[9] || "",
      phone: r[10] || "",
      email: r[11] || "",
      transactionCode: r[12] || "",
      status: r[13] || "",
      requestId: r[14] || "",
      rejectionReason: r[15] || "",  // P
      rejectionNotes: r[16] || ""    // Q
    });
  }

  return bookings;
}

/*********************************
 * APPROVE / REJECT
 *********************************/
function approveBooking_(bookingId, resend, eventKey) {
  const keys = eventKey ? [eventKey] : ["groove","tempo","apt"];

  for (let k = 0; k < keys.length; k++) {
    const sheet = getSheet_(keys[k]);
    const out = approveBookingInSheet_(sheet, bookingId, resend, keys[k]);
    if (out && out.found) return out;
  }

  return { success: false, found: false, error: "Booking not found" };
}

function approveBookingInSheet_(sheet, bookingId, resend, eventKey) {
  bookingId = norm_(bookingId);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const range = sheet.getDataRange();
    const rows = range.getValues();

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (norm_(r[1]) !== bookingId) continue;

      const currentStatus = norm_(r[13] || "PENDING");
      const name = r[9];
      const email = r[11];
      const desc = r[4];
      const amount = r[8];
      const qty = r[5];

      if (currentStatus === "CONFIRMED" && !resend) {
        return {
          success: true,
          found: true,
          alreadyConfirmed: true,
          emailSent: false,
          message: "Already confirmed (no resend)."
        };
      }

      if (currentStatus !== "CONFIRMED") {
        sheet.getRange(i + 1, 14).setValue("CONFIRMED");
      }

      try {
        const emailSent = sendConfirmedEmail(name, email, bookingId, desc, amount, qty, eventLabel_(eventKey), eventKey);
        if (!emailSent) {
          return {
            success: true,
            found: true,
            alreadyConfirmed: (currentStatus === "CONFIRMED"),
            emailSent: false,
            message: "Confirmed, but no email on file."
          };
        }

        return {
          success: true,
          found: true,
          alreadyConfirmed: (currentStatus === "CONFIRMED"),
          emailSent: true,
          message: "Approved + email sent."
        };

      } catch (err) {
        return {
          success: false,
          found: true,
          error: "EMAIL_FAILED: " + (err && err.message ? err.message : String(err)),
          alreadyConfirmed: (currentStatus === "CONFIRMED"),
          emailSent: false
        };
      }
    }

    return { success: false, found: false, error: "Booking not found" };

  } finally {
    lock.releaseLock();
  }
}

function rejectBooking_(bookingId, eventKey, rejectionReason, rejectionNotes) {
  const keys = eventKey ? [eventKey] : ["groove","tempo","apt"];

  for (let k = 0; k < keys.length; k++) {
    const sheet = getSheet_(keys[k]);
    const out = rejectBookingInSheet_(sheet, bookingId, rejectionReason, rejectionNotes, keys[k]);
    if (out && out.found) return out;
  }

  return { success: false, found: false, error: "Booking not found" };
}

function rejectBookingInSheet_(sheet, bookingId, rejectionReason, rejectionNotes, eventKey) {
  bookingId = norm_(bookingId);
  rejectionReason = norm_(rejectionReason || "other");
  rejectionNotes = norm_(rejectionNotes || "");

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const rows = sheet.getDataRange().getValues();

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (norm_(r[1]) !== bookingId) continue;

      const name = r[9];
      const email = r[11];
      const desc = r[4];
      const amount = r[8];
      const qty = r[5];
      const currentStatus = norm_(r[13] || "PENDING");

      // Update status to REJECTED
      sheet.getRange(i + 1, 14).setValue("REJECTED");
      
      // Store rejection reason and notes in columns P and Q
      sheet.getRange(i + 1, 16).setValue(rejectionReason);  // P
      sheet.getRange(i + 1, 17).setValue(rejectionNotes);   // Q

      // Send rejection email
      let emailSent = false;
      let emailError = "";
      try {
        emailSent = sendRejectionEmail_(name, email, bookingId, desc, amount, qty, rejectionReason, rejectionNotes, eventLabel_(eventKey));
      } catch (err) {
        emailSent = false;
        emailError = "REJECTION_EMAIL_FAILED: " + (err && err.message ? err.message : String(err));
      }

      return {
        success: true,
        found: true,
        emailSent: emailSent,
        emailError: emailError || undefined,
        message: emailSent ? "Booking rejected + email sent." : "Booking rejected (email failed)."
      };
    }

    return { success: false, found: false, error: "Booking not found" };

  } finally {
    lock.releaseLock();
  }
}

function undoRejection_(bookingId, eventKey) {
  const keys = eventKey ? [eventKey] : ["groove","tempo","apt"];

  for (let k = 0; k < keys.length; k++) {
    const sheet = getSheet_(keys[k]);
    const out = undoRejectionInSheet_(sheet, bookingId);
    if (out && out.found) return out;
  }

  return { success: false, found: false, error: "Booking not found" };
}

function undoRejectionInSheet_(sheet, bookingId) {
  bookingId = norm_(bookingId);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const rows = sheet.getDataRange().getValues();

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (norm_(r[1]) !== bookingId) continue;

      const currentStatus = norm_(r[13] || "");
      
      // Only allow undo if status is REJECTED
      if (currentStatus !== "REJECTED") {
        return {
          success: false,
          found: true,
          error: "Booking is not in REJECTED status. Current status: " + currentStatus
        };
      }

      // Change status back to PENDING
      sheet.getRange(i + 1, 14).setValue("PENDING");
      
      // Keep rejection reason/notes for audit trail (don't clear them)
      // This allows tracking what happened even after undo

      return {
        success: true,
        found: true,
        message: "Rejection undone - booking restored to PENDING."
      };
    }

    return { success: false, found: false, error: "Booking not found" };

  } finally {
    lock.releaseLock();
  }
}

/*********************************
 * VERIFY + CHECKIN
 *********************************/
function verifyBooking_(bookingId, eventKey) {
  const keys = eventKey ? [eventKey] : ["groove","tempo","apt"];

  for (let k = 0; k < keys.length; k++) {
    const sheet = getSheet_(keys[k]);
    const out = verifyBookingInSheet_(sheet, bookingId, keys[k]);
    if (out.found) return out;
  }

  return { found: false };
}

function verifyBookingInSheet_(sheet, bookingId, eventKey) {
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (norm_(r[1]) !== norm_(bookingId)) continue;

    const qty = safeNum_(r[5], 1);
    const checked = safeNum_(r[6], 0);
    const remaining = Math.max(0, qty - checked);
    const status = norm_(r[13] || "PENDING");
    const validForEntry = (status === "CONFIRMED" && remaining > 0);

    return {
      found: true,
      eventKey,
      booking: {
        bookingId: r[1] || "",
        bookingType: r[2] || "",
        tier: r[3] || "",
        description: r[4] || "",
        quantity: qty,
        checkedInCount: checked,
        lastCheckInTime: r[7] || "",
        amount: r[8] || "",
        name: r[9] || "",
        phone: r[10] || "",
        email: r[11] || "",
        status: status
      },
      remaining,
      validForEntry
    };
  }

  return { found: false };
}

function checkIn_(bookingId, count, eventKey) {
  const keys = eventKey ? [eventKey] : ["groove","tempo","apt"];

  for (let k = 0; k < keys.length; k++) {
    const sheet = getSheet_(keys[k]);
    const out = checkInInSheet_(sheet, bookingId, count);
    if (out && out.ok) return out;
  }

  return { ok: false, error: "Not found" };
}

function checkInInSheet_(sheet, bookingId, count) {
  const lock = LockService.getScriptLock();
  lock.waitLock(8000);

  try {
    const rows = sheet.getDataRange().getValues();

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (norm_(r[1]) !== norm_(bookingId)) continue;

      const status = norm_(r[13] || "PENDING");
      const qty = safeNum_(r[5], 1);
      let checked = safeNum_(r[6], 0);

      const remaining = Math.max(0, qty - checked);
      if (status !== "CONFIRMED") return { ok: false, error: "Not confirmed" };
      if (remaining <= 0) return { ok: false, error: "No remaining entries" };

      let add = 0;
      if (count === "all") {
        add = remaining;
      } else {
        add = safeNum_(count, 1);
        add = Math.max(1, add);
        add = Math.min(add, remaining);
      }

      checked += add;

      sheet.getRange(i + 1, 7).setValue(checked);
      sheet.getRange(i + 1, 8).setValue(new Date().toISOString());

      const out = verifyBookingInSheet_(sheet, bookingId);
      return { ok: true, added: add, ...out };
    }

    return { ok: false, error: "Not found" };

  } finally {
    lock.releaseLock();
  }
}

/*********************************
 * EMAILS
 *********************************/
function sendPendingEmail_(name, email, bookingId, description, quantity, eventLabel) {
  email = norm_(email);
  if (!email) return false;

  MailApp.sendEmail({
    to: email,
    subject: `${eventLabel} Booking Received – Pending Verification`,
    htmlBody: `
      <div style="font-family:Arial,sans-serif;line-height:1.6">
        <p>Hi <b>${esc_(name)}</b>,</p>
        <p>Your booking has been received for <b>${esc_(eventLabel)}</b> and is <b>pending verification</b>.</p>
        <p><b>Booking ID:</b> ${esc_(bookingId)}<br/>
           <b>Details:</b> ${esc_(description)}<br/>
           <b>Quantity:</b> ${esc_(quantity)}</p>
        <p style="margin-top:14px">— BYZ Entertainment</p>
      </div>
    `
  });

  return true;  
}

function sendConfirmedEmail(name, email, bookingId, description, amount, quantity, eventLabel, eventKey) {
  email = norm_(email);
  if (!email) return false;

  bookingId = norm_(bookingId);

  const qrPayload = WEBAPP_URL + "?event=" + encodeURIComponent(eventKey) + "&bid=" + encodeURIComponent(bookingId);

  const qrUrl =
    "https://api.qrserver.com/v1/create-qr-code/?size=420x420&data=" +
    encodeURIComponent(qrPayload);

  const resp = UrlFetchApp.fetch(qrUrl, { muteHttpExceptions: true, followRedirects: true });
  const code = resp.getResponseCode();
  if (code !== 200) {
    throw new Error("QR_FETCH_FAILED: " + code + " " + resp.getContentText().slice(0, 200));
  }

  const qrBlob = resp.getBlob().setName("BYZ-QR-" + bookingId + ".png");
  const backupVerifyLink = qrPayload;

  MailApp.sendEmail({
    to: email,
    cc: BYZ_EMAIL,
    subject: `${eventLabel} Booking Confirmed 🎉`,
    htmlBody: `
      <div style="font-family:Arial,sans-serif;line-height:1.6">
        <p>Hi <b>${esc_(name)}</b>,</p>
        <p>Your booking for <b>${esc_(eventLabel)}</b> has been <b>CONFIRMED</b>.</p>

        <p>
          <b>Booking ID:</b> ${esc_(bookingId)}<br/>
          <b>Details:</b> ${esc_(description)}<br/>
          <b>Quantity:</b> ${esc_(quantity)}<br/>
          <b>Amount Paid:</b> ${esc_(amount)}
        </p>

        <p><b>Entry QR:</b></p>
        <img src="cid:qrcode" width="240" height="240"
             style="border-radius:16px;border:1px solid #ddd" />

        <p style="margin:10px 0 0 0; color:#666; font-size:12px">
          Backup link: ${backupVerifyLink}
        </p>

        <p style="margin-top:12px">— BYZ Entertainment</p>
      </div>
    `,
    inlineImages: { qrcode: qrBlob },
    attachments: [qrBlob]
  });

  return true;
}

function sendRejectionEmail_(name, email, bookingId, description, amount, quantity, rejectionReason, rejectionNotes, eventLabel) {
  email = norm_(email);
  // Email is required for bookings (QR codes), so this should always be present
  if (!email) {
    console.warn("Rejection email not sent: no email on file for booking " + bookingId);
    return false;
  }

  // Map rejection reason codes to user-friendly messages
  const reasonMessages = {
    "transaction_amount_mismatch": "The payment amount received doesn't match the booking amount. Please verify your M-Pesa transaction and contact us if you believe this is an error.",
    "invalid_transaction_code": "The transaction code provided could not be verified. Please check your M-Pesa transaction code and contact us if you need assistance.",
    "duplicate_booking": "This booking appears to be a duplicate. If you believe this is an error, please contact us.",
    "fraudulent_activity": "This booking has been flagged for review. Please contact us for more information.",
    "other": rejectionNotes || "This booking could not be processed. Please contact us for more information."
  };

  const reasonText = reasonMessages[rejectionReason] || reasonMessages["other"];
  const contactInfo = "Phone: +255 768 464 367 | Email: " + BYZ_EMAIL;

  MailApp.sendEmail({
    to: email,
    cc: BYZ_EMAIL,
    subject: `${eventLabel} Booking Rejected`,
    htmlBody: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;max-width:600px">
        <p>Hi <b>${esc_(name)}</b>,</p>
        
        <p>We regret to inform you that your booking for <b>${esc_(eventLabel)}</b> has been <b>rejected</b>.</p>

        <div style="background:#fff3cd;border-left:4px solid #ffc107;padding:12px;margin:16px 0;border-radius:4px">
          <p style="margin:0;font-weight:600;color:#856404">Reason:</p>
          <p style="margin:4px 0 0 0;color:#856404">${esc_(reasonText)}</p>
        </div>

        <p><b>Booking Details:</b></p>
        <ul style="margin:8px 0;padding-left:20px">
          <li><b>Booking ID:</b> ${esc_(bookingId)}</li>
          <li><b>Details:</b> ${esc_(description)}</li>
          <li><b>Quantity:</b> ${esc_(quantity)}</li>
          ${amount ? `<li><b>Amount:</b> ${esc_(amount)} TZS</li>` : ""}
        </ul>

        <p style="margin-top:20px">If you believe this is an error or have questions, please contact us:</p>
        <p style="margin:8px 0;color:#666">${esc_(contactInfo)}</p>

        <p style="margin-top:20px">You may submit a new booking if you'd like to try again.</p>

        <p style="margin-top:16px;color:#666;font-size:14px">— BYZ Entertainment</p>
      </div>
    `
  });

  return true;
}

/*********************************
 * DEDUPE + UTILS
 *********************************/
function findBookingIdByTxn_(sheet, txn) {
  txn = norm_(txn);
  if (!txn) return "";

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return "";

  const ids  = sheet.getRange(2, 2,  lastRow - 1, 1).getValues();
  const txns = sheet.getRange(2, 13, lastRow - 1, 1).getValues();

  for (let i = 0; i < txns.length; i++) {
    if (norm_(txns[i][0]) === txn) return norm_(ids[i][0]);
  }
  return "";
}

function findBookingIdByRequestId_(sheet, requestId) {
  requestId = norm_(requestId);
  if (!requestId) return "";

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return "";

  const ids  = sheet.getRange(2, 2,  lastRow - 1, 1).getValues();
  const rids = sheet.getRange(2, 15, lastRow - 1, 1).getValues();

  for (let i = 0; i < rids.length; i++) {
    if (norm_(rids[i][0]) === requestId) return norm_(ids[i][0]);
  }
  return "";
}

function generateBookingId_(eventKey, type) {
  const evt = String(eventKey || "GEN").toUpperCase();
  const t = String(type || "GEN").toUpperCase();
  const rand = Math.floor(1000 + Math.random() * 9000);
  const stamp = Date.now().toString().slice(-4);
  return `BYZ-${evt}-${t}-${rand}${stamp}`;
}

function normalizeEvent_(v) {
  const s = String(v || "").toLowerCase().trim();
  if (s === "groove" || s === "tempo" || s === "apt") return s;
  return "";
}

function eventLabel_(eventKey) {
  if (eventKey === "tempo") return "Tempo";
  if (eventKey === "apt") return "APT Session";
  return "Groove Series";
}

function safeNum_(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function norm_(v) {
  return String(v || "").trim();
}

function esc_(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function json_(obj) {
  // Note: ContentService doesn't support setHeaders()
  // CORS is handled automatically by Google Apps Script web app deployment settings
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/*********************************
 * CORS HANDLING
 *********************************/
// Note: doOptions() is now defined at the top of MAIN HANDLERS section
// CORS headers are automatically handled by Google Apps Script web app deployment
// Make sure deployment settings are:
// - Execute as: Me
// - Who has access: Anyone (or "Anyone with Google account")
// - Add-ons: DISABLED


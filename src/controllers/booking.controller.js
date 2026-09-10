/**
 * DROP-IN: src/controllers/booking.controller.js
 * Public booking. Monthly cap is on the CLINIC (User._id), not the patient.
 * Do not leak plan names / used counts on the booking page.
 *
 * Near-limit mail is FROM Orvexify TO the clinic (and doctor if different).
 * Once per calendar month per plan. Does not use the clinic SMTP.
 *
 * Env (platform mailbox):
 *   ORVEXIFY_SMTP_HOST / ORVEXIFY_SMTP_PORT / ORVEXIFY_SMTP_USER / ORVEXIFY_SMTP_PASS
 *   ORVEXIFY_FROM_EMAIL=Orvexify <support@orvexify.com>
 * Fallback: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL
 */

const crypto = require('crypto');
const moment = require('moment-timezone');
const User = require('../models/User');
const Doctor = require('../models/Doctor');
const Patient = require('../models/Patient');
const Appointment = require('../models/Appointment');
const { sendBookingConfirmation } = require('../services/emailService');
const { scheduleAppointmentReminders } = require('../services/reminderScheduler');
const { assertAppointmentLimit } = require('./billing.controller');

const PLAN_COPY = {
  free: { name: 'Free', appointments: '15', doctors: '1' },
  starter: { name: 'Starter', appointments: '300', doctors: '2' },
  growth: { name: 'Growth', appointments: '1,500', doctors: '6' },
  pro: { name: 'Pro', appointments: 'unlimited', doctors: 'unlimited' },
};

function defaultWorkingHours() {
  return {
    monday: { enabled: true, start: '09:00', end: '17:00' },
    tuesday: { enabled: true, start: '09:00', end: '17:00' },
    wednesday: { enabled: true, start: '09:00', end: '17:00' },
    thursday: { enabled: true, start: '09:00', end: '17:00' },
    friday: { enabled: true, start: '09:00', end: '13:00' },
    saturday: { enabled: false, start: '10:00', end: '14:00' },
    sunday: { enabled: false, start: '09:00', end: '17:00' },
  };
}

function withHours(doctor) {
  if (!doctor.workingHours || Object.keys(doctor.workingHours).length === 0) {
    doctor.workingHours = defaultWorkingHours();
  }
  return doctor;
}

function clinicContactEmail(clinic, doctor) {
  return (
    (clinic && (clinic.email || clinic.clinicEmail || clinic.publicEmail)) ||
    (doctor && doctor.email) ||
    ''
  );
}

function publicBookingClosedPayload(clinic, doctor) {
  const email = clinicContactEmail(clinic, doctor);
  return {
    success: false,
    code: 'PLAN_LIMIT_APPOINTMENTS',
    bookingOpen: false,
    contactEmail: email || null,
    message: email
      ? `This clinic is not taking online bookings this month. Please email ${email} to request an appointment.`
      : 'This clinic is not taking online bookings this month. Please email the clinic to request an appointment.',
  };
}

async function appointmentLimitState(ownerId) {
  try {
    const info = await assertAppointmentLimit(ownerId);
    return {
      open: true,
      used: info.used,
      limit: info.limit,
      planKey: info.planKey,
    };
  } catch (err) {
    if (err && err.code === 'PLAN_LIMIT_APPOINTMENTS') {
      return {
        open: false,
        used: err.meta && err.meta.used,
        limit: err.meta && err.meta.limit,
        planKey: err.meta && err.meta.planKey,
      };
    }
    console.error('bookingOpen check:', err && err.message);
    return { open: true };
  }
}

function clientUrl() {
  return (
    process.env.CLIENT_URL ||
    process.env.FRONTEND_URL ||
    'https://orvexify.com'
  ).replace(/\/$/, '');
}

function billingUrl() {
  return `${clientUrl()}/dashboard/billing`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function limitKind(used, limit) {
  if (limit == null || !Number.isFinite(Number(used)) || !Number.isFinite(Number(limit))) {
    return null;
  }
  const usedN = Number(used);
  const limitN = Number(limit);
  if (limitN <= 0) return null;
  if (usedN >= limitN) return 'full';
  const remaining = limitN - usedN;
  if (remaining <= 3 || usedN / limitN >= 0.8) return 'near';
  return null;
}

function warnKeyFor(planKey, kind) {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${ym}:${planKey || 'free'}:${kind}`;
}

async function claimLimitWarn(userId, warnKey) {
  if (!userId || !warnKey) return false;
  let Subscription;
  try {
    Subscription = require('../models/Subscription');
  } catch (err) {
    console.error('claimLimitWarn Subscription', err && err.message);
    return false;
  }

  try {
    const { ensureSubscription } = require('./billing.controller');
    await ensureSubscription(userId);
  } catch (err) {
    console.error('claimLimitWarn ensureSubscription', err && err.message);
  }

  const row = await Subscription.findOneAndUpdate(
    {
      user: userId,
      $or: [
        { limitWarnKey: { $exists: false } },
        { limitWarnKey: null },
        { limitWarnKey: { $ne: warnKey } },
      ],
    },
    { $set: { limitWarnKey: warnKey, limitWarnAt: new Date() } },
    { new: true }
  );
  return Boolean(row);
}

function uniqueEmails(list) {
  const seen = {};
  const out = [];
  (list || []).forEach((raw) => {
    const email = String(raw || '').trim().toLowerCase();
    if (!email || !email.includes('@') || seen[email]) return;
    seen[email] = true;
    out.push(email);
  });
  return out;
}

function planBlurb(planKey, kind) {
  const plan = PLAN_COPY[planKey] || PLAN_COPY.free;
  if (kind === 'full') {
    if (planKey === 'growth') {
      return `Growth includes ${plan.appointments} appointments this calendar month. Update to Pro for unlimited bookings so patients can keep using your page.`;
    }
    if (planKey === 'starter') {
      return `Starter includes ${plan.appointments} appointments this calendar month. Update to Growth (1,500) or Pro (unlimited) to open the page again.`;
    }
    return `Free includes ${plan.appointments} appointments this calendar month and ${plan.doctors} doctor. Update your plan so patients can book online again.`;
  }
  if (planKey === 'growth') {
    return `Growth includes ${plan.appointments} appointments this calendar month. If this month stays busy, update to Pro for unlimited bookings.`;
  }
  if (planKey === 'starter') {
    return `Starter includes ${plan.appointments} appointments this calendar month. Update to Growth (1,500) or Pro (unlimited) when you need more room.`;
  }
  return `Free includes ${plan.appointments} appointments this calendar month and ${plan.doctors} doctor. Update to Starter, Growth or Pro to keep the booking page open.`;
}

function buildLimitEmail({ clinicName, used, limit, planKey, kind }) {
  const plan = PLAN_COPY[planKey] || PLAN_COPY.free;
  const remaining = Math.max(0, Number(limit) - Number(used));
  const name = clinicName || 'there';
  const url = billingUrl();
  const usedLabel = `${used} of ${limit}`;
  const subject =
    kind === 'full'
      ? 'Online booking is paused on your Orvexify page'
      : 'Your Orvexify booking page is almost full this month';

  const lead =
    kind === 'full'
      ? `Online booking on your page is paused for the rest of this calendar month. You are at ${usedLabel} appointments on ${plan.name}. Patients who open the link now see a message to email you instead of a booking form.`
      : `Your booking page is close to this month’s limit: ${usedLabel} appointments on ${plan.name} (${remaining} left). When the limit is reached, patients will not be able to book online — they will be asked to email you.`;

  const blurb = planBlurb(planKey, kind);
  const text = [
    `Hi ${name},`,
    '',
    lead,
    '',
    blurb,
    '',
    `Update your plan: ${url}`,
    '',
    'This does not cancel anything already booked. Email reminders for those visits still go out.',
    '',
    'Questions: support@orvexify.com',
    '',
    '— Orvexify',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f5fb;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td style="padding:18px 28px;background:linear-gradient(135deg,#803aff 0%,#4e49ff 48%,#06a6f8 100%);color:#ffffff;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;">
              Orvexify
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px;font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#0f172a;">
              ${kind === 'full' ? 'Online booking is paused' : 'Your booking page is almost full'}
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 20px;font-size:15px;line-height:1.6;color:#334155;">
              Hi ${escapeHtml(name)},
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 16px;font-size:15px;line-height:1.65;color:#334155;">
              ${escapeHtml(lead)}
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 20px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f8ff;border:1px solid #e4e7ff;border-radius:12px;">
                <tr>
                  <td style="padding:14px 16px;font-size:13px;color:#64748b;">
                    This month<br />
                    <strong style="font-size:18px;color:#4e49ff;">${escapeHtml(String(used))} / ${escapeHtml(String(limit))}</strong>
                    <span style="color:#94a3b8;"> on ${escapeHtml(plan.name)}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 22px;font-size:15px;line-height:1.65;color:#334155;">
              ${escapeHtml(blurb)}
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px;" align="left">
              <a href="${escapeHtml(url)}" style="display:inline-block;background:#4e49ff;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 20px;border-radius:10px;">
                Update plan
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 24px;font-size:13px;line-height:1.6;color:#64748b;">
              Already-booked visits stay on the calendar. Email reminders still go out at 24 hours, 2 hours and 30 minutes.
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 22px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#94a3b8;">
              Sent by Orvexify · Questions:
              <a href="mailto:support@orvexify.com" style="color:#4e49ff;text-decoration:none;">support@orvexify.com</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

let cachedTransport = null;

function getOrvexifyTransport() {
  if (cachedTransport) return cachedTransport;
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    return null;
  }
  const host =
    process.env.EMAIL_HOST ||
    process.env.SMTP_HOST ||
    process.env.EMAIL_HOST;
  const user =
    process.env.ORVEXIFY_SMTP_USER ||
    process.env.SMTP_USER ||
    process.env.EMAIL_USER;
  const pass =
    process.env.ORVEXIFY_SMTP_PASS ||
    process.env.SMTP_PASS ||
    process.env.EMAIL_PASS;
  if (!host || !user || !pass) return null;
  const port = Number(
    process.env.ORVEXIFY_SMTP_PORT ||
      process.env.SMTP_PORT ||
      process.env.EMAIL_PORT ||
      465
  );
  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return cachedTransport;
}

async function sendOrvexifyMail({ to, subject, text, html }) {
  const from =
    process.env.ORVEXIFY_FROM_EMAIL ||
    process.env.FROM_EMAIL ||
    'Orvexify <support@orvexify.com>';

  try {
    const mail = require('../services/emailService');
    if (typeof mail.sendOrvexifyEmail === 'function') {
      await mail.sendOrvexifyEmail({ to, subject, text, html, from });
      return true;
    }
    if (typeof mail.sendPlatformEmail === 'function') {
      await mail.sendPlatformEmail({ to, subject, text, html, from });
      return true;
    }
    if (typeof mail.sendSystemEmail === 'function') {
      await mail.sendSystemEmail({ to, subject, text, html, from });
      return true;
    }
  } catch (err) {
    console.error('orvexifyMail emailService', err && err.message);
  }

  const transport = getOrvexifyTransport();
  if (!transport) {
    console.warn(
      'orvexifyMail: set ORVEXIFY_SMTP_HOST / USER / PASS (or SMTP_HOST) to email clinics from Orvexify'
    );
    return false;
  }

  await transport.sendMail({
    from,
    to,
    replyTo: 'support@orvexify.com',
    subject,
    text,
    html,
  });
  return true;
}

async function maybeNotifyPlanLimit({ clinic, doctor, used, limit, planKey } = {}) {
  try {
    const kind = limitKind(used, limit);
    if (!kind) return { sent: false, reason: 'not_near' };

    const userId = clinic && (clinic._id || clinic.id || clinic.userId);
    if (!userId) return { sent: false, reason: 'no_clinic' };

    const key = warnKeyFor(planKey, kind);
    const claimed = await claimLimitWarn(userId, key);
    if (!claimed) return { sent: false, reason: 'already_sent' };

    let clinicName = (clinic && (clinic.clinicName || clinic.name)) || '';
    let clinicEmail = clinicContactEmail(clinic, null);
    if (!clinicEmail || !clinicName) {
      try {
        const row = await User.findById(userId).select('email clinicName').lean();
        if (row) {
          clinicEmail = clinicEmail || row.email || '';
          clinicName = clinicName || row.clinicName || '';
        }
      } catch (err) {
        console.error('maybeNotifyPlanLimit load clinic', err && err.message);
      }
    }

    const recipients = uniqueEmails([
      clinicEmail,
      doctor && doctor.email,
    ]);
    if (!recipients.length) {
      console.warn('maybeNotifyPlanLimit: no clinic/doctor email');
      return { sent: false, reason: 'no_email' };
    }

    const payload = buildLimitEmail({
      clinicName,
      used,
      limit,
      planKey: planKey || 'free',
      kind,
    });

    for (let i = 0; i < recipients.length; i += 1) {
      try {
        await sendOrvexifyMail({ to: recipients[i], ...payload });
        console.log(`✅ Orvexify limit email (${kind}) → ${recipients[i]}`);
      } catch (err) {
        console.error('maybeNotifyPlanLimit send', recipients[i], err && err.message);
      }
    }
    return { sent: true, kind, to: recipients };
  } catch (err) {
    console.error('maybeNotifyPlanLimit', err && err.message);
    return { sent: false, reason: 'error' };
  }
}

function notifyInBackground(args) {
  void maybeNotifyPlanLimit(args);
}

async function getPublicClinic(req, res) {
  try {
    const { slug } = req.params;

    console.log(`📋 Public request: Fetching clinic with slug: ${slug}`);

    const clinic = await User.findOne({ bookingSlug: slug })
      .select('-passwordHash -tokenVersion -__v -smtpHost -fromEmail -emailPassword -useTLS -useSSL')
      .lean();

    if (!clinic) {
      return res.status(404).json({
        success: false,
        message: 'Clinic not found',
      });
    }

    if (clinic.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Clinic is currently inactive',
      });
    }

    const doctors = await Doctor.find({
      userId: clinic._id,
      isActive: true,
    })
      .select('name email phone specialty imageIcon bio qualifications languages experience consultationFee rating reviewCount workingHours breakTime slotDuration bufferBetweenSlots')
      .lean();

    const doctorsWithHours = doctors.map((doctor) => withHours(doctor));
    const state = await appointmentLimitState(clinic._id);
    const contactEmail = clinic.email || null;

    console.log(`✅ Found clinic: ${clinic.clinicName} (${clinic.timezone || 'Asia/Karachi'})`);
    console.log(`✅ Found ${doctorsWithHours.length} doctors`);
    console.log(`✅ Booking open: ${state.open}`);

    res.json({
      success: true,
      bookingOpen: state.open,
      contactEmail,
      clinic: {
        id: clinic._id,
        name: clinic.clinicName,
        description: clinic.clinicDescription || 'Quality healthcare services',
        address: clinic.clinicAddress || 'Address not specified',
        phone: clinic.clinicPhone || '',
        email: clinic.email,
        logo: clinic.clinicLogo,
        timezone: clinic.timezone || 'Asia/Karachi',
        rating: clinic.rating || 4.8,
        reviewCount: clinic.reviewCount || 120,
        bookingSlug: clinic.bookingSlug,
        isActive: clinic.isActive,
      },
      doctors: doctorsWithHours,
    });

    notifyInBackground({
      clinic,
      used: state.used,
      limit: state.limit,
      planKey: state.planKey,
    });
  } catch (error) {
    console.error('❌ Get clinic error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error: ' + error.message,
    });
  }
}

async function getPublicDoctor(req, res) {
  try {
    const { doctorId } = req.params;

    console.log(`📋 Public request: Fetching doctor ${doctorId}`);

    const doctor = await Doctor.findById(doctorId)
      .select('name email phone specialty imageIcon bio qualifications languages experience consultationFee rating reviewCount workingHours breakTime slotDuration bufferBetweenSlots')
      .lean();

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found',
      });
    }

    if (doctor.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Doctor is currently inactive',
      });
    }

    res.json({
      success: true,
      doctor: withHours(doctor),
    });
  } catch (error) {
    console.error('❌ Get doctor error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error: ' + error.message,
    });
  }
}

async function getPublicSlots(req, res) {
  const { clinicId, doctorId, date } = req.body;

  console.log(`📅 Public request: Available slots for doctor ${doctorId} on ${date}`);

  try {
    const clinic = await User.findById(clinicId).select('timezone isActive email clinicName').lean();

    if (!clinic) {
      return res.status(404).json({
        success: false,
        message: 'Clinic not found',
      });
    }

    if (clinic.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Clinic is currently inactive',
      });
    }

    const state = await appointmentLimitState(clinicId);
    if (!state.open) {
      notifyInBackground({
        clinic,
        used: state.used,
        limit: state.limit,
        planKey: state.planKey,
      });
      return res.json({
        success: true,
        slots: [],
        bookedSlots: [],
        bookingOpen: false,
        contactEmail: clinic.email || null,
        message: 'This clinic is not taking online bookings this month.',
      });
    }

    const doctor = await Doctor.findOne({ _id: doctorId, userId: clinicId });

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found',
      });
    }

    if (doctor.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Doctor is currently inactive',
      });
    }

    const clinicTimezone = clinic.timezone || 'Asia/Karachi';
    console.log(`🕐 Clinic Timezone: ${clinicTimezone}`);

    const dateObj = moment.tz(date, 'YYYY-MM-DD', clinicTimezone);
    const dayName = dateObj.format('dddd').toLowerCase();
    console.log(`📆 Day in clinic timezone: ${dayName}, Date: ${dateObj.format('YYYY-MM-DD')}`);

    const daySchedule = doctor.workingHours && doctor.workingHours[dayName];

    if (!daySchedule || !daySchedule.enabled) {
      console.log(`❌ Doctor not available on: ${dayName}`);
      return res.json({
        success: true,
        slots: [],
        bookedSlots: [],
        message: 'Doctor not available on this day',
      });
    }

    console.log('✅ Day schedule:', daySchedule);

    const slots = [];
    const slotDuration = doctor.slotDuration || 30;
    const buffer = doctor.bufferBetweenSlots || 5;

    const startTime = moment.tz(
      `${dateObj.format('YYYY-MM-DD')} ${daySchedule.start}`,
      'YYYY-MM-DD HH:mm',
      clinicTimezone
    );
    const endTime = moment.tz(
      `${dateObj.format('YYYY-MM-DD')} ${daySchedule.end}`,
      'YYYY-MM-DD HH:mm',
      clinicTimezone
    );

    console.log(`⏰ Start: ${startTime.format('HH:mm')}, End: ${endTime.format('HH:mm')}`);

    const bookedAppointments = await Appointment.find({
      doctorId,
      appointmentDate: date,
      status: { $in: ['scheduled', 'confirmed', 'pending'] },
    })
      .select('appointmentTime status patientName')
      .lean();

    const bookedTimes = bookedAppointments.map((apt) => apt.appointmentTime);
    const bookedSlots = bookedAppointments.map((apt) => ({
      time: apt.appointmentTime,
      status: apt.status,
      patientName: apt.patientName,
    }));

    let breakStart = null;
    let breakEnd = null;
    if (doctor.breakTime && doctor.breakTime.enabled) {
      breakStart = moment.tz(
        `${dateObj.format('YYYY-MM-DD')} ${doctor.breakTime.start}`,
        'YYYY-MM-DD HH:mm',
        clinicTimezone
      );
      breakEnd = moment.tz(
        `${dateObj.format('YYYY-MM-DD')} ${doctor.breakTime.end}`,
        'YYYY-MM-DD HH:mm',
        clinicTimezone
      );
      console.log(`🕐 Break: ${breakStart.format('HH:mm')} - ${breakEnd.format('HH:mm')}`);
    }

    let current = moment(startTime);
    let slotCount = 0;
    let availableCount = 0;

    const now = moment().tz(clinicTimezone);
    const todayStr = now.format('YYYY-MM-DD');
    const isToday = date === todayStr;

    console.log(`🕐 Current time in clinic timezone: ${now.format('YYYY-MM-DD HH:mm')}`);
    console.log(`📅 Is today: ${isToday}`);

    while (current.isBefore(endTime)) {
      const timeString = current.format('HH:mm');

      let isBreak = false;
      if (breakStart && breakEnd) {
        if (current.isBetween(breakStart, breakEnd, null, '[)')) {
          isBreak = true;
        }
      }

      const isBooked = bookedTimes.includes(timeString);
      let isPast = false;
      if (isToday && current.isBefore(now)) {
        isPast = true;
      }

      const isAvailable = !isBreak && !isBooked && !isPast;

      slots.push({
        time: timeString,
        available: isAvailable,
        isBooked,
        isBreak,
        isPast,
      });

      slotCount += 1;
      if (isAvailable) availableCount += 1;

      current.add(slotDuration + buffer, 'minutes');
    }

    console.log(`✅ Generated ${slotCount} slots, ${availableCount} available`);

    res.json({
      success: true,
      slots,
      bookedSlots,
      doctorName: doctor.name,
      date,
      dayName,
      timezone: clinicTimezone,
      workingHours: daySchedule,
      totalSlots: slotCount,
      availableSlots: availableCount,
    });
  } catch (error) {
    console.error('❌ Get slots error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error: ' + error.message,
    });
  }
}

async function bookPublicAppointment(req, res) {
  const {
    clinicId,
    doctorId,
    patientName,
    patientEmail,
    patientPhone,
    patientWhatsapp,
    appointmentDate,
    appointmentTime,
    notes,
  } = req.body;

  console.log(`📋 Public request: Booking appointment for ${patientEmail}`);

  try {
    if (!clinicId || !doctorId || !patientName || !patientEmail || !appointmentDate || !appointmentTime) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
    }

    const clinic = await User.findById(clinicId)
      .select('clinicName timezone isActive email')
      .lean();

    if (!clinic) {
      return res.status(404).json({
        success: false,
        message: 'Clinic not found',
      });
    }

    if (clinic.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Clinic is currently inactive',
      });
    }

    const clinicTimezone = clinic.timezone || 'Asia/Karachi';

    const doctor = await Doctor.findById(doctorId).select('name isActive email').lean();

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found',
      });
    }

    if (doctor.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Doctor is currently inactive',
      });
    }

    let limitInfo;
    try {
      limitInfo = await assertAppointmentLimit(clinicId);
    } catch (limitErr) {
      if (limitErr && limitErr.code === 'PLAN_LIMIT_APPOINTMENTS') {
        notifyInBackground({
          clinic,
          doctor,
          used: limitErr.meta && limitErr.meta.used,
          limit: limitErr.meta && limitErr.meta.limit,
          planKey: limitErr.meta && limitErr.meta.planKey,
        });
        return res.status(403).json(publicBookingClosedPayload(clinic, doctor));
      }
      throw limitErr;
    }

    const existingAppointment = await Appointment.findOne({
      doctorId,
      appointmentDate,
      appointmentTime,
      status: { $in: ['scheduled', 'confirmed', 'pending'] },
    });

    if (existingAppointment) {
      return res.status(400).json({
        success: false,
        message: 'This time slot is no longer available',
      });
    }

    let patient = await Patient.findOne({
      email: patientEmail,
      userId: clinicId,
    });

    if (!patient) {
      patient = await Patient.create({
        userId: clinicId,
        name: patientName,
        email: patientEmail,
        phone: patientPhone,
        whatsapp: patientWhatsapp || '',
        notes: notes || '',
        timezone: clinicTimezone,
      });
    } else {
      patient.name = patientName;
      patient.phone = patientPhone || patient.phone;
      patient.whatsapp = patientWhatsapp || patient.whatsapp;
      if (notes) patient.notes = notes;
      patient.timezone = clinicTimezone;
      await patient.save();
    }

    const confirmationToken = crypto.randomBytes(32).toString('hex');
    const cancellationToken = crypto.randomBytes(32).toString('hex');

    const appointment = await Appointment.create({
      userId: clinicId,
      patientId: patient._id,
      doctorId,
      appointmentDate,
      appointmentTime,
      status: 'scheduled',
      confirmationStatus: 'pending',
      confirmationToken,
      cancellationToken,
      notes: notes || '',
      timezone: clinicTimezone,
    });

    console.log(`✅ Appointment created: ${appointment._id}`);

    console.log('📋 [SCHEDULE] Calling scheduleAppointmentReminders...');
    try {
      const scheduleResult = await scheduleAppointmentReminders(appointment);
      console.log('📋 [SCHEDULE] Result:', scheduleResult);

      if (scheduleResult.success) {
        console.log(`✅ [SCHEDULE] ${scheduleResult.scheduled || 0} reminders scheduled`);
      } else {
        console.error('❌ [SCHEDULE] Failed:', scheduleResult.error);
      }
    } catch (scheduleError) {
      console.error('❌ [SCHEDULE] Error:', scheduleError);
    }

    try {
      await sendBookingConfirmation(
        clinicId,
        patientEmail,
        patientName,
        appointmentDate,
        appointmentTime,
        clinic.clinicName || 'Clinic',
        doctor.name || 'Doctor',
        clinicTimezone
      );
      console.log('✅ Confirmation email sent to:', patientEmail);
    } catch (emailError) {
      console.error('⚠️ Email sending failed:', emailError);
    }

    const usedAfter =
      limitInfo && limitInfo.used != null ? Number(limitInfo.used) + 1 : null;
    notifyInBackground({
      clinic,
      doctor,
      used: usedAfter,
      limit: limitInfo && limitInfo.limit,
      planKey: limitInfo && limitInfo.planKey,
    });

    res.json({
      success: true,
      message: 'Appointment booked successfully',
      appointment: {
        id: appointment._id,
        date: appointmentDate,
        time: appointmentTime,
        doctorName: doctor.name || 'Doctor',
        clinicName: clinic.clinicName || 'Clinic',
        timezone: clinicTimezone,
        confirmationToken,
        cancellationToken,
      },
    });
  } catch (error) {
    console.error('❌ Book appointment error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error: ' + error.message,
    });
  }
}

module.exports = {
  getPublicClinic,
  getPublicDoctor,
  getPublicSlots,
  bookPublicAppointment,
  maybeNotifyPlanLimit,
};

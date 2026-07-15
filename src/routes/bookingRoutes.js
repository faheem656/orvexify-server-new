// src/routes/bookingRoutes.js — COMPLETE FIXED

const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const moment = require("moment-timezone");
const User = require("../models/User");
const Doctor = require("../models/Doctor");
const Patient = require("../models/Patient");
const Appointment = require("../models/Appointment");
const { sendBookingConfirmation } = require("../services/emailService");
// ✅ ADD THIS IMPORT
const { scheduleAppointmentReminders } = require("../services/reminderScheduler");

// ============ GET CLINIC BY SLUG (PUBLIC) ============
router.get("/clinic/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    console.log(`📋 Public request: Fetching clinic with slug: ${slug}`);

    const clinic = await User.findOne({ bookingSlug: slug })
      .select("-passwordHash -tokenVersion -__v -smtpHost -fromEmail -emailPassword -useTLS -useSSL")
      .lean();

    if (!clinic) {
      return res.status(404).json({
        success: false,
        message: "Clinic not found"
      });
    }

    if (clinic.isActive === false) {
      return res.status(403).json({
        success: false,
        message: "Clinic is currently inactive"
      });
    }

    const doctors = await Doctor.find({
      userId: clinic._id,
      isActive: true,
    })
    .select("name email phone specialty imageIcon bio qualifications languages experience consultationFee rating reviewCount workingHours breakTime slotDuration bufferBetweenSlots")
    .lean();

    const doctorsWithHours = doctors.map(doctor => {
      if (!doctor.workingHours || Object.keys(doctor.workingHours).length === 0) {
        doctor.workingHours = {
          monday: { enabled: true, start: '09:00', end: '17:00' },
          tuesday: { enabled: true, start: '09:00', end: '17:00' },
          wednesday: { enabled: true, start: '09:00', end: '17:00' },
          thursday: { enabled: true, start: '09:00', end: '17:00' },
          friday: { enabled: true, start: '09:00', end: '13:00' },
          saturday: { enabled: false, start: '10:00', end: '14:00' },
          sunday: { enabled: false, start: '09:00', end: '17:00' }
        };
      }
      return doctor;
    });

    console.log(`✅ Found clinic: ${clinic.clinicName} (${clinic.timezone || 'Asia/Karachi'})`);
    console.log(`✅ Found ${doctorsWithHours.length} doctors`);

    res.json({
      success: true,
      clinic: {
        id: clinic._id,
        name: clinic.clinicName,
        description: clinic.clinicDescription || "Quality healthcare services",
        address: clinic.clinicAddress || "Address not specified",
        phone: clinic.clinicPhone || "",
        email: clinic.email,
        logo: clinic.clinicLogo,
        timezone: clinic.timezone || "Asia/Karachi",
        rating: clinic.rating || 4.8,
        reviewCount: clinic.reviewCount || 120,
        bookingSlug: clinic.bookingSlug,
        isActive: clinic.isActive
      },
      doctors: doctorsWithHours
    });
  } catch (error) {
    console.error("❌ Get clinic error:", error);
    res.status(500).json({
      success: false,
      message: "Server error: " + error.message
    });
  }
});

// ============ GET DOCTOR DETAILS (PUBLIC) ============
router.get("/doctor/:doctorId", async (req, res) => {
  try {
    const { doctorId } = req.params;

    console.log(`📋 Public request: Fetching doctor ${doctorId}`);

    const doctor = await Doctor.findById(doctorId)
      .select("name email phone specialty imageIcon bio qualifications languages experience consultationFee rating reviewCount workingHours breakTime slotDuration bufferBetweenSlots")
      .lean();

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor not found"
      });
    }

    if (doctor.isActive === false) {
      return res.status(403).json({
        success: false,
        message: "Doctor is currently inactive"
      });
    }

    if (!doctor.workingHours || Object.keys(doctor.workingHours).length === 0) {
      doctor.workingHours = {
        monday: { enabled: true, start: '09:00', end: '17:00' },
        tuesday: { enabled: true, start: '09:00', end: '17:00' },
        wednesday: { enabled: true, start: '09:00', end: '17:00' },
        thursday: { enabled: true, start: '09:00', end: '17:00' },
        friday: { enabled: true, start: '09:00', end: '13:00' },
        saturday: { enabled: false, start: '10:00', end: '14:00' },
        sunday: { enabled: false, start: '09:00', end: '17:00' }
      };
    }

    res.json({
      success: true,
      doctor: doctor
    });
  } catch (error) {
    console.error('❌ Get doctor error:', error);
    res.status(500).json({
      success: false,
      message: "Server error: " + error.message
    });
  }
});

// ============ GET AVAILABLE SLOTS (PUBLIC) ============
router.post("/available-slots", async (req, res) => {
  const { clinicId, doctorId, date } = req.body;

  console.log(`📅 Public request: Available slots for doctor ${doctorId} on ${date}`);

  try {
    const clinic = await User.findById(clinicId).select('timezone isActive').lean();
    
    if (!clinic) {
      return res.status(404).json({
        success: false,
        message: "Clinic not found"
      });
    }

    if (clinic.isActive === false) {
      return res.status(403).json({
        success: false,
        message: "Clinic is currently inactive"
      });
    }

    const doctor = await Doctor.findOne({ _id: doctorId, userId: clinicId });

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor not found"
      });
    }

    if (doctor.isActive === false) {
      return res.status(403).json({
        success: false,
        message: "Doctor is currently inactive"
      });
    }

    const clinicTimezone = clinic.timezone || 'Asia/Karachi';
    console.log(`🕐 Clinic Timezone: ${clinicTimezone}`);

    const dateObj = moment.tz(date, 'YYYY-MM-DD', clinicTimezone);
    const dayName = dateObj.format('dddd').toLowerCase();
    console.log(`📆 Day in clinic timezone: ${dayName}, Date: ${dateObj.format('YYYY-MM-DD')}`);

    const daySchedule = doctor.workingHours?.[dayName];

    if (!daySchedule || !daySchedule.enabled) {
      console.log(`❌ Doctor not available on: ${dayName}`);
      return res.json({
        success: true,
        slots: [],
        bookedSlots: [],
        message: "Doctor not available on this day"
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
      doctorId: doctorId,
      appointmentDate: date,
      status: { $in: ["scheduled", "confirmed", "pending"] },
    }).select("appointmentTime status patientName").lean();

    const bookedTimes = bookedAppointments.map((apt) => apt.appointmentTime);
    const bookedSlots = bookedAppointments.map((apt) => ({
      time: apt.appointmentTime,
      status: apt.status,
      patientName: apt.patientName
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
      if (isToday) {
        if (current.isBefore(now)) {
          isPast = true;
        }
      }

      const isAvailable = !isBreak && !isBooked && !isPast;

      slots.push({
        time: timeString,
        available: isAvailable,
        isBooked: isBooked,
        isBreak: isBreak,
        isPast: isPast
      });

      slotCount++;
      if (isAvailable) availableCount++;

      current.add(slotDuration + buffer, 'minutes');
    }

    console.log(`✅ Generated ${slotCount} slots, ${availableCount} available`);

    res.json({
      success: true,
      slots: slots,
      bookedSlots: bookedSlots,
      doctorName: doctor.name,
      date: date,
      dayName: dayName,
      timezone: clinicTimezone,
      workingHours: daySchedule,
      totalSlots: slotCount,
      availableSlots: availableCount
    });
  } catch (error) {
    console.error('❌ Get slots error:', error);
    res.status(500).json({
      success: false,
      message: "Server error: " + error.message
    });
  }
});

// ============ BOOK APPOINTMENT (PUBLIC) ============
router.post("/book", async (req, res) => {
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
        message: "Missing required fields"
      });
    }

    const clinic = await User.findById(clinicId).select('clinicName timezone isActive').lean();
    
    if (!clinic) {
      return res.status(404).json({
        success: false,
        message: "Clinic not found"
      });
    }

    if (clinic.isActive === false) {
      return res.status(403).json({
        success: false,
        message: "Clinic is currently inactive"
      });
    }

    const clinicTimezone = clinic.timezone || 'Asia/Karachi';

    const doctor = await Doctor.findById(doctorId).select('name isActive').lean();
    
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor not found"
      });
    }

    if (doctor.isActive === false) {
      return res.status(403).json({
        success: false,
        message: "Doctor is currently inactive"
      });
    }

    const existingAppointment = await Appointment.findOne({
      doctorId,
      appointmentDate,
      appointmentTime,
      status: { $in: ["scheduled", "confirmed", "pending"] },
    });

    if (existingAppointment) {
      return res.status(400).json({
        success: false,
        message: "This time slot is no longer available",
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
        whatsapp: patientWhatsapp || "",
        notes: notes || "",
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

    const confirmationToken = crypto.randomBytes(32).toString("hex");
    const cancellationToken = crypto.randomBytes(32).toString("hex");

    const appointment = await Appointment.create({
      userId: clinicId,
      patientId: patient._id,
      doctorId: doctorId,
      appointmentDate,
      appointmentTime,
      status: "scheduled",
      confirmationStatus: "pending",
      confirmationToken,
      cancellationToken,
      notes: notes || "",
      timezone: clinicTimezone,
    });

    console.log(`✅ Appointment created: ${appointment._id}`);

    // ============================================================
    // ✅ CRITICAL: Schedule Reminders
    // ============================================================
    console.log('📋 [SCHEDULE] Calling scheduleAppointmentReminders...');
    try {
      const scheduleResult = await scheduleAppointmentReminders(appointment);
      console.log(`📋 [SCHEDULE] Result:`, scheduleResult);
      
      if (scheduleResult.success) {
        console.log(`✅ [SCHEDULE] ${scheduleResult.scheduled || 0} reminders scheduled`);
      } else {
        console.error(`❌ [SCHEDULE] Failed:`, scheduleResult.error);
      }
    } catch (scheduleError) {
      console.error('❌ [SCHEDULE] Error:', scheduleError);
    }
    // ============================================================

    // ✅ Send confirmation email
    try {
      await sendBookingConfirmation(
        clinicId,
        patientEmail,
        patientName,
        appointmentDate,
        appointmentTime,
        clinic.clinicName || "Clinic",
        doctor.name || "Doctor",
        clinicTimezone
      );
      console.log('✅ Confirmation email sent to:', patientEmail);
    } catch (emailError) {
      console.error('⚠️ Email sending failed:', emailError);
    }

    res.json({
      success: true,
      message: "Appointment booked successfully",
      appointment: {
        id: appointment._id,
        date: appointmentDate,
        time: appointmentTime,
        doctorName: doctor.name || "Doctor",
        clinicName: clinic.clinicName || "Clinic",
        timezone: clinicTimezone,
        confirmationToken,
        cancellationToken,
      },
    });
  } catch (error) {
    console.error('❌ Book appointment error:', error);
    res.status(500).json({
      success: false,
      message: "Server error: " + error.message,
    });
  }
});

module.exports = router;
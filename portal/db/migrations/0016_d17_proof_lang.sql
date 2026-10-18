-- Store the customer's chosen language on the D17 payment row so admin
-- approval/rejection emails match the language they used at checkout.
-- Without this, Arabic-speaking customers receive French emails because
-- the admin action has no way to know the original choice.
ALTER TABLE payments_d17 ADD COLUMN lang text;
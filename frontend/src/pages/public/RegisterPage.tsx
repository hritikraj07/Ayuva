import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, FieldLabel, Input, Select } from "@/components/ui/primitives";
import { useAuth } from "@/context/AuthContext";

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"patient" | "doctor" | "admin">("patient");
  const [specialty, setSpecialty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (fullName.trim().length < 2) {
      setError("Full name must be at least 2 characters.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const user = await register({
        full_name: fullName.trim(),
        email: email.trim(),
        password,
        role,
        specialty_or_department: specialty.trim() || undefined,
      });
      if (user.role === "admin") navigate("/admin/overview");
      else if (user.role === "doctor") navigate("/doctor/records");
      else navigate("/patient/overview");
    } catch (err: any) {
      setError(err?.message || "Registration failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <Link to="/" aria-label="Ayuva home">
            <BrandMark />
          </Link>
          <Link to="/login" className="text-sm font-medium text-secondary hover:underline">
            Already registered? Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 items-center px-4 py-10">
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="text-xl">Create Ayuva Account</CardTitle>
            <CardDescription>Select your role to initialize role-isolated permissions.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
              {error && <Alert variant="danger">{error}</Alert>}
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="reg-name">Full Name</FieldLabel>
                <Input
                  id="reg-name"
                  placeholder="Your full name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="reg-email">Email Address</FieldLabel>
                <Input
                  id="reg-email"
                  type="email"
                  placeholder="email@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="reg-password">Password (minimum 8 characters)</FieldLabel>
                <Input
                  id="reg-password"
                  type="password"
                  placeholder="Create a strong password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="reg-role">Account Role</FieldLabel>
                <Select
                  id="reg-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as "patient" | "doctor" | "admin")}
                >
                  <option value="patient">Patient (Personal Health Vault &amp; AI Assistant)</option>
                  <option value="doctor">Doctor (Scoped Shared Record Viewer)</option>
                  <option value="admin">Public Health Administrator (Outbreak Intelligence)</option>
                </Select>
              </div>
              {role !== "patient" && (
                <div className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor="reg-dept">
                    {role === "doctor" ? "Medical Specialty" : "Public Health Department"}
                  </FieldLabel>
                  <Input
                    id="reg-dept"
                    placeholder={role === "doctor" ? "e.g. Internal Medicine" : "e.g. District Disease Surveillance Unit"}
                    value={specialty}
                    onChange={(e) => setSpecialty(e.target.value)}
                  />
                </div>
              )}
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                <span>{submitting ? "Creating account..." : "Register Account"}</span>
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

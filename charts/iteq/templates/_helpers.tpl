{{- define "iteq.fullname" -}}
{{- if contains "iteq" .Release.Name -}}
{{- .Release.Name | trunc 40 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-iteq" .Release.Name | trunc 40 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "iteq.labels" -}}
app.kubernetes.io/name: iteq
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "iteq.apiImage" -}}
{{ .Values.image.api.repository }}:{{ .Values.image.api.tag | default .Chart.AppVersion }}
{{- end -}}

{{- define "iteq.webImage" -}}
{{ .Values.image.web.repository }}:{{ .Values.image.web.tag | default .Chart.AppVersion }}
{{- end -}}

{{- define "iteq.dbSecretName" -}}
{{- if .Values.postgres.cnpg.enabled -}}
{{ include "iteq.fullname" . }}-db-app
{{- else -}}
{{ required "postgres.existingUriSecret is required when postgres.cnpg.enabled=false" .Values.postgres.existingUriSecret }}
{{- end -}}
{{- end -}}
